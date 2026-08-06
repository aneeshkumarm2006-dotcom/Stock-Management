// Amount-line mapping shared by POST /api/pm/recurring-transactions and
// PATCH /api/pm/recurring-transactions/[id].
//
// Both routes rebuild `amounts[]` wholesale from the client payload, and both
// used to hand-roll the same field-by-field mapping. That is exactly the shape
// where a new field gets added to one and forgotten in the other — and because
// zod strips unknown keys, the symptom is silent data loss rather than an
// error. One mapper, two callers.

import { Types } from 'mongoose';
import { toCents, fromCents } from '@/lib/pm/currency';

export interface AmountLineInput {
  scopeType?: 'Property' | 'Company';
  scopeId?: string | null;
  unitId?: string | null;
  accountId?: string;
  description?: string;
  refNo?: string;
  /** Dollars at the API boundary. */
  amount?: number;
  allocation?: {
    mode?: 'None' | 'CompanyProperties';
    basis?: 'Equal' | 'Manual';
    weights?: Array<{ propertyId: string; weight: number }>;
  } | null;
}

/** Client payload → the persisted shape (ObjectIds + integer cents). */
export function mapAmountLineToDb(a: AmountLineInput) {
  return {
    scopeType: a.scopeType,
    scopeId: a.scopeId ? new Types.ObjectId(a.scopeId) : null,
    unitId: a.unitId ? new Types.ObjectId(a.unitId) : null,
    accountId: a.accountId ? new Types.ObjectId(a.accountId) : null,
    description: a.description,
    refNo: a.refNo,
    amount: toCents(a.amount ?? 0),
    // Only persist a real allocation. `{mode:'None'}` and null are the same
    // thing, and storing null keeps every untouched row byte-identical to how
    // it looked before allocation existed.
    allocation:
      a.allocation && a.allocation.mode === 'CompanyProperties'
        ? {
            mode: 'CompanyProperties' as const,
            basis: a.allocation.basis ?? ('Equal' as const),
            weights: (a.allocation.weights ?? []).map((w) => ({
              propertyId: new Types.ObjectId(w.propertyId),
              weight: w.weight,
            })),
          }
        : null,
  };
}

interface AmountLineDoc {
  scopeType?: string | null;
  scopeId?: unknown;
  unitId?: unknown;
  accountId?: unknown;
  description?: string;
  refNo?: string;
  amount?: number;
  allocation?: {
    mode?: string;
    basis?: string;
    weights?: Array<{ propertyId?: unknown; weight?: number }>;
  } | null;
}

/**
 * Persisted shape → the client payload.
 *
 * The edit modal rebuilds the whole `amounts[]` array on save, so anything this
 * omits is silently cleared the next time a user opens a rule and presses Save
 * without touching it.
 */
export function serializeAmountLine(a: AmountLineDoc) {
  return {
    scopeType: (a.scopeType as 'Property' | 'Company') ?? 'Company',
    scopeId: a.scopeId ? String(a.scopeId) : null,
    unitId: a.unitId ? String(a.unitId) : null,
    accountId: a.accountId ? String(a.accountId) : null,
    description: a.description ?? '',
    refNo: a.refNo ?? null,
    /** Cents — the modal divides by 100 for display. */
    amount: a.amount ?? 0,
    allocation:
      a.allocation && a.allocation.mode === 'CompanyProperties'
        ? {
            mode: 'CompanyProperties' as const,
            basis: (a.allocation.basis as 'Equal' | 'Manual') ?? 'Equal',
            weights: (a.allocation.weights ?? []).map((w) => ({
              propertyId: String(w.propertyId),
              weight: w.weight ?? 0,
            })),
          }
        : null,
  };
}

export { fromCents };
