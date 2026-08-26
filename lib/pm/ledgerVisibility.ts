// Ledger visibility — the single source of truth for "which JournalEntry rows
// does a report count?".
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// Voiding a Posted JE does two things (see lib/pm/reverseJournalEntry.ts):
//   (1) flips the original to status='Voided'
//   (2) writes a paired reversing JE — debits↔credits swapped, status='Posted'
//
// A reporting query that filters on `status: 'Posted'` alone therefore drops
// (1) but keeps (2), leaving a bare −amount in the period. The void doesn't
// cancel out — it actively subtracts from whatever else shares that
// account/property/month:
//
//   Jan School Taxes, one property: bill A C$711.43 (voided), bill B C$724.73
//   → matrix showed 724.73 − 711.43 = C$13.30 instead of C$724.73.
//
// The original header comments claimed the reversal let reports "still net to
// zero" while filtering out Voided rows. That reasoning is inverted: the
// reversal nets the ORIGINAL to zero, so it is only correct to count the
// reversal when the original is counted too. Count exactly one of the pair and
// the void leaks a phantom amount.
//
// THE RULE
// --------
// A voided JE and its reversal are ONE unit. Either count both (they sum to
// zero) or count neither. This helper implements "count neither", which is
// also what a reader expects: a voided transaction contributes nothing, and no
// mirror-image row clutters the ledger.
//
// `reversesJournalEntryId` is set only by `reverseJournalEntry`, which always
// flips its original to Voided in the same call — so a non-null value reliably
// identifies the reversal half of a voided pair. `{ field: null }` also matches
// documents predating the field, so historical rows stay visible.
//
// Use `ledgerVisibleMatch()` for any query that SUMS or LISTS ledger activity
// (P&L, balance sheet, budgets, bank balances, AR, reconciliation). Do NOT use
// it when loading one specific JE by id for editing or audit display — those
// paths need to see voided rows and reversals.
import type { FilterQuery } from "mongoose";

/**
 * Mongo match fragment selecting JEs that count toward reports: Posted, and
 * not the reversal half of a voided pair.
 *
 * Returns a fresh object each call so callers can spread/mutate it safely.
 */
export function ledgerVisibleMatch(): {
  status: "Posted";
  reversesJournalEntryId: null;
} {
  return { status: "Posted", reversesJournalEntryId: null };
}

/**
 * Same rule applied to an already-loaded document (or lean row) instead of a
 * query — for the handful of paths that filter in memory.
 */
export function isLedgerVisible(je: {
  status?: string | null;
  reversesJournalEntryId?: unknown;
}): boolean {
  return je.status === "Posted" && !je.reversesJournalEntryId;
}

/** Convenience for callers that build a `FilterQuery<IJournalEntry>`. */
export function withLedgerVisible<T>(filter: FilterQuery<T>): FilterQuery<T> {
  return { ...filter, ...ledgerVisibleMatch() } as FilterQuery<T>;
}
