// The database-touching half of the scope module.
//
// lib/pm/scope.ts must stay mongoose-free because client components import it.
// Everything that needs a query lives here: turning scopes into human labels,
// and building the Mongo match clauses that used to be hand-written at each
// call site.

import { Types } from "mongoose";
import { resolveLocationDisplays } from "@/lib/pm/locationDisplay";
import {
  normalizeScope,
  scopeKey,
  type PmScope,
  type ScopeLike,
} from "@/lib/pm/scope";

export interface ScopeDisplay {
  /** Property name, CompanyAccount name, or "Company" for the legacy bucket. */
  label: string;
  kind: "Property" | "Company";
  href: string | null;
}

/** Label shown for a Company row that predates named companies. */
export const LEGACY_COMPANY_LABEL = "Company";

/**
 * Batch-resolve scopes to display labels, keyed by `scopeKey`.
 *
 * Delegates to `resolveLocationDisplays` rather than forking it: that helper
 * already knows `pm_company_accounts` (its projection map and label formatter
 * both handle it), already batches one `$in` per collection, already scopes
 * every query to the org, and already falls back gracefully on a dangling FK.
 * All we add is the scope→locationType mapping, the re-key onto `scopeKey`, and
 * the legacy-bucket entry that has no row to look up.
 */
export async function resolveScopeLabels(
  scopes: Array<ScopeLike | PmScope>,
  orgId: string | Types.ObjectId,
): Promise<Map<string, ScopeDisplay>> {
  const out = new Map<string, ScopeDisplay>();

  const normalized = scopes.map((s) =>
    "type" in s && (s.type === "Property" || s.type === "Company")
      ? (s as PmScope)
      : normalizeScope(s as ScopeLike),
  );

  const locations = normalized
    .filter((s) => s.id !== null && s.id !== undefined)
    .map((s) => ({
      locationType: s.type === "Property" ? "Property" : "CompanyAccount",
      locationId: String(s.id),
    }));

  const displays = locations.length
    ? await resolveLocationDisplays(locations, orgId)
    : {};

  for (const scope of normalized) {
    const key = scopeKey(scope);
    if (out.has(key)) continue;
    if (scope.id === null || scope.id === undefined) {
      out.set(key, {
        label: LEGACY_COMPANY_LABEL,
        kind: "Company",
        href: null,
      });
      continue;
    }
    const found = displays[String(scope.id)];
    out.set(key, {
      label:
        found?.label ??
        (scope.type === "Property" ? "Unknown property" : "Unknown company"),
      kind: scope.type,
      href: found?.href ?? null,
    });
  }

  return out;
}

/**
 * Match clause for journal-entry lines carrying a given scope.
 *
 * A Company scope that names a CompanyAccount matches BOTH its own id and the
 * legacy `null` rows, because `null` means "the organization's own books" and
 * those were never backfilled. That dual-read is what lets a Company budget's
 * actuals stay correct across the boundary where named companies were
 * introduced. See the backward-compatibility note in the plan.
 */
export function scopeMatchClause(
  scope: PmScope,
  opts?: { prefix?: string; includeLegacyCompany?: boolean },
): Record<string, unknown> {
  const prefix = opts?.prefix ?? "lines";
  if (scope.type === "Property") {
    return {
      [`${prefix}.scopeType`]: "Property",
      [`${prefix}.scopeId`]: new Types.ObjectId(String(scope.id)),
    };
  }
  if (!scope.id) {
    return {
      [`${prefix}.scopeType`]: "Company",
      [`${prefix}.scopeId`]: null,
    };
  }
  const ids: Array<Types.ObjectId | null> = [
    new Types.ObjectId(String(scope.id)),
  ];
  if (opts?.includeLegacyCompany !== false) ids.push(null);
  return {
    [`${prefix}.scopeType`]: "Company",
    [`${prefix}.scopeId`]: { $in: ids },
  };
}

/**
 * The guard that any per-property aggregation needs. Without it, an aggregation
 * that groups on `lines.scopeId` will start bucketing CompanyAccount ids as if
 * they were properties the moment Company rows carry real ids —
 * /api/pm/outstanding-balances had exactly this latent bug.
 */
export const PROPERTY_SCOPE_LINE_CLAUSE = {
  "lines.scopeType": "Property",
  "lines.scopeId": { $ne: null },
} as const;
