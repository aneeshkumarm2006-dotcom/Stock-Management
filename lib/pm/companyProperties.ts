// Resolve a CompanyAccount into the weighted set of properties a company-level
// cost may be split across.
//
// This is the data half of the insurance-allocation feature: a blanket premium
// scoped to "Ramco company" gets divided over exactly the buildings that
// company owns, so each one's P&L carries its share instead of the whole cost
// sitting above every property in an undifferentiated company bucket.
//
// Two rules do all the work:
//   1. Membership is `Property.companyAccountId` — explicit, never inferred
//      from the property name.
//   2. Eligibility is currency equality. The ledger never converts on write
//      (lib/pm/currency.ts), so a CAD premium cannot be apportioned onto a
//      building that books in USD. Mismatched properties are EXCLUDED and
//      named, never silently included and never silently dropped.

import { Types } from "mongoose";
import { Property } from "@/lib/db/models/pm/Property";
import { CompanyAccount } from "@/lib/db/models/pm/CompanyAccount";
import { Organization } from "@/lib/db/models/pm/Organization";
import {
  resolveCompanyCurrency,
  resolvePropertyCurrency,
} from "@/lib/pm/currency";
import type { AllocationWeight } from "@/lib/pm/allocation";
import type { PmCurrency } from "@/types/pm";

/**
 * How a company-level amount is divided.
 *
 * `Equal` is the default and the only basis that is stable across periods: a
 * recurring rule posts every month, and ownership percentages, square footage
 * and rent all drift, which would make the same rule allocate differently each
 * period and destroy period-over-period comparability. `Manual` is the escape
 * hatch for when the real per-building premiums are known.
 *
 * Ownership % is deliberately NOT offered: `Property.rentalOwners[].ownershipPct`
 * sums to 100 *per property* (BR-PU-1), so as a cross-property basis it yields
 * weights identical to Equal while appearing to mean something.
 */
export type AllocationBasis = "Equal" | "Manual";

export const ALLOCATION_BASES: readonly AllocationBasis[] = [
  "Equal",
  "Manual",
] as const;

export interface CompanyPropertyMember {
  propertyId: string;
  propertyName: string;
  currency: PmCurrency;
  weight: number;
}

export type ExclusionReason = "CURRENCY_MISMATCH" | "ZERO_WEIGHT";

export interface CompanyPropertyExclusion {
  propertyId: string;
  propertyName: string;
  currency: PmCurrency;
  reason: ExclusionReason;
}

export interface CompanyPropertySet {
  companyAccountId: string;
  companyName: string;
  /** The company's resolved booking currency — what members must match. */
  currency: PmCurrency;
  basis: AllocationBasis;
  members: CompanyPropertyMember[];
  excluded: CompanyPropertyExclusion[];
  /** False ⇒ the caller must post the amount unallocated at company scope. */
  allocatable: boolean;
}

export interface ResolveCompanyPropertiesInput {
  orgId: string | Types.ObjectId;
  companyAccountId: string | Types.ObjectId;
  basis?: AllocationBasis;
  manualWeights?: Array<{ propertyId: string; weight: number }>;
}

interface PropertyLean {
  _id: Types.ObjectId;
  propertyName?: string;
  currency?: PmCurrency | null;
  companyAccountId?: Types.ObjectId | null;
}

export async function resolveCompanyProperties(
  input: ResolveCompanyPropertiesInput,
): Promise<CompanyPropertySet | null> {
  const orgObjectId =
    typeof input.orgId === "string"
      ? new Types.ObjectId(input.orgId)
      : input.orgId;
  const companyId = String(input.companyAccountId);
  if (!Types.ObjectId.isValid(companyId)) return null;
  const companyObjectId = new Types.ObjectId(companyId);
  const basis: AllocationBasis = input.basis ?? "Equal";

  const [company, org, properties] = await Promise.all([
    CompanyAccount.findOne({
      _id: companyObjectId,
      organizationId: orgObjectId,
    })
      .select({ name: 1, currency: 1 })
      .lean<{ name?: string; currency?: PmCurrency | null } | null>(),
    Organization.findById(orgObjectId)
      .select({ defaultCurrency: 1 })
      .lean<{ defaultCurrency?: PmCurrency } | null>(),
    Property.find({
      organizationId: orgObjectId,
      companyAccountId: companyObjectId,
      active: true,
    })
      .select({ _id: 1, propertyName: 1, currency: 1, companyAccountId: 1 })
      .sort({ propertyName: 1 })
      .lean<PropertyLean[]>(),
  ]);

  // A company that was archived out from under a rule is not an error — the
  // caller posts unallocated and surfaces a warning.
  if (!company) return null;

  const orgDefault = org?.defaultCurrency ?? null;
  const companyCurrency = resolveCompanyCurrency(company.currency, orgDefault);

  const manualByProperty = new Map(
    (input.manualWeights ?? []).map((w) => [String(w.propertyId), w.weight]),
  );

  const members: CompanyPropertyMember[] = [];
  const excluded: CompanyPropertyExclusion[] = [];

  for (const p of properties) {
    const propertyId = String(p._id);
    const propertyName = p.propertyName || "(unnamed property)";
    // Never read `Property.currency` raw — that loses the org fallback and a
    // property predating the field would look like a mismatch.
    const currency = resolvePropertyCurrency(p.currency, orgDefault);

    if (currency !== companyCurrency) {
      excluded.push({
        propertyId,
        propertyName,
        currency,
        reason: "CURRENCY_MISMATCH",
      });
      continue;
    }

    const weight =
      basis === "Manual" ? (manualByProperty.get(propertyId) ?? 0) : 1;

    if (!Number.isFinite(weight) || weight <= 0) {
      // Under Manual this is a legitimate "this building isn't on the policy".
      // Recorded rather than silently ignored so the UI can show it.
      excluded.push({ propertyId, propertyName, currency, reason: "ZERO_WEIGHT" });
      continue;
    }

    members.push({ propertyId, propertyName, currency, weight });
  }

  return {
    companyAccountId: companyId,
    companyName: company.name ?? "(unnamed company)",
    currency: companyCurrency,
    basis,
    members,
    excluded,
    allocatable: members.length > 0,
  };
}

/** The shape `allocateCents` wants, keyed by property id. */
export function membersToWeights(
  members: CompanyPropertyMember[],
): AllocationWeight[] {
  return members.map((m) => ({ key: m.propertyId, weight: m.weight }));
}

/**
 * Per-run memoized resolver.
 *
 * A catch-up can walk 24 periods of the same rule; without this each period
 * would re-query the company and its properties. Cache key includes the basis
 * and the manual weights, so a rule carrying two differently-weighted lines on
 * one company still resolves correctly.
 */
export function createCompanyPropertyResolver(orgId: string | Types.ObjectId) {
  const cache = new Map<string, Promise<CompanyPropertySet | null>>();
  return function resolve(
    companyAccountId: string | Types.ObjectId,
    basis: AllocationBasis = "Equal",
    manualWeights?: Array<{ propertyId: string; weight: number }>,
  ): Promise<CompanyPropertySet | null> {
    const key = [
      String(companyAccountId),
      basis,
      (manualWeights ?? [])
        .map((w) => `${w.propertyId}:${w.weight}`)
        .sort()
        .join(","),
    ].join("|");
    let hit = cache.get(key);
    if (!hit) {
      hit = resolveCompanyProperties({
        orgId,
        companyAccountId,
        basis,
        manualWeights,
      });
      cache.set(key, hit);
    }
    return hit;
  };
}
