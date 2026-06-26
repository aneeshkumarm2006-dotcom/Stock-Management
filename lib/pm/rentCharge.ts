// rentCharge — builds the journal-entry lines for ONE period of a lease's
// PRIMARY rent (base `primaryRent` + every `splitRentCharges` recovery line).
//
// The rent TERMS are the single source of truth for base rent: there is no
// separate `recurringCharges[]` row for it. `primaryRent.nextDueDate` is the
// schedule cursor and the lease `rentCycle` is the frequency. Both the manual
// "Post recurring due now" button (POST /api/pm/leases/:id/post-recurring-charges)
// and the nightly cron (`runLeaseRecurringPoster`) call this so the accounting
// is identical on both paths.
//
// A rent charge is an ACCRUAL — the tenant now owes us, cash arrives later — so
// the debit leg is Accounts Receivable for the full rent, with one income
// credit per component (base + each recovery). The result is always balanced:
//   DR Accounts Receivable   total
//     CR base rent income          primaryRent.amount
//     CR recovery income           splitRentCharges[i].amount …
import { Types } from 'mongoose';

/** Minimal shape needed to build a rent charge from a lease's rent TERMS. */
export interface RentChargeSource {
  primaryRent: { amount: number; accountId: Types.ObjectId; memo?: string };
  splitRentCharges: { amount: number; accountId: Types.ObjectId; memo?: string }[];
  propertyId: Types.ObjectId;
  unitId: Types.ObjectId;
}

export interface RentChargeLine {
  accountId: Types.ObjectId;
  scopeType: 'Property';
  scopeId: Types.ObjectId;
  unitId: Types.ObjectId;
  description: string;
  debit: number;
  credit: number;
}

/**
 * Build the balanced JE lines for one rent period. Amounts are integer cents,
 * matching the JournalEntry storage convention.
 *
 * Returns `null` when the resolved rent total is 0 (nothing to post) so callers
 * can skip without advancing their cursor.
 */
export function buildRentChargeLines(
  source: RentChargeSource,
  accountsReceivableCoaId: Types.ObjectId,
): { lines: RentChargeLine[]; total: number } | null {
  const base = source.primaryRent?.amount ?? 0;
  const splits = (source.splitRentCharges ?? []).filter(
    (c) => (c.amount ?? 0) > 0,
  );
  const total = base + splits.reduce((s, c) => s + (c.amount ?? 0), 0);
  if (total <= 0) return null;

  const credits: RentChargeLine[] = [];
  if (base > 0) {
    credits.push({
      accountId: source.primaryRent.accountId,
      scopeType: 'Property',
      scopeId: source.propertyId,
      unitId: source.unitId,
      description: source.primaryRent.memo?.trim() || 'Base rent income',
      debit: 0,
      credit: base,
    });
  }
  for (const c of splits) {
    credits.push({
      accountId: c.accountId,
      scopeType: 'Property',
      scopeId: source.propertyId,
      unitId: source.unitId,
      description: c.memo?.trim() || 'Recovery charge income',
      debit: 0,
      credit: c.amount,
    });
  }

  const lines: RentChargeLine[] = [
    {
      accountId: accountsReceivableCoaId,
      scopeType: 'Property',
      scopeId: source.propertyId,
      unitId: source.unitId,
      description: 'Rent receivable',
      debit: total,
      credit: 0,
    },
    ...credits,
  ];
  return { lines, total };
}
