// Cash-basis filter — BR-AC-2 honored at the read layer only (the toggle
// must never modify journal rows). Used by:
//   - /api/pm/financials/matrix  (Slice 7-adjacent)
//   - /api/pm/company-financials (Slice 7)
//   - /api/pm/1099               (Slice 8 — aggregates only paid amounts)
//
// Strategy: a JournalEntry contributes to cash-basis reports when at
// least one of its lines hits a cash CoA — i.e. an account whose
// ChartOfAccount.type is `Current Asset (cash)`. That's the practical
// proxy for "cash actually moved" without re-traversing every
// BillPayment/Deposit/EFT link. Accrual-mode reports include every
// posted (non-voided) JE.
//
// `applyCashBasis(lines, opts)` filters an array of "shaped" JE row
// objects (whichever projection the caller built) using a Set of cash
// JE IDs that the caller pre-computed via `collectCashJournalEntryIds`.
import type { Types } from 'mongoose';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import type { AccountingMode } from '@/types/pm';

export interface CashBasisFilterOpts {
  orgId: Types.ObjectId;
  /** Inclusive date range bounds; pass the same window the report uses. */
  from?: Date;
  to?: Date;
}

/**
 * Build the set of JournalEntry._id strings whose lines touch a cash
 * CoA (`type === 'Current Asset (cash)'`). The caller then uses this
 * set to filter row projections.
 *
 * This is the only DB hit; report endpoints can call it once per
 * request and reuse the Set when filtering many row shapes.
 */
export async function collectCashJournalEntryIds(
  opts: CashBasisFilterOpts,
): Promise<Set<string>> {
  const cashAccounts = await ChartOfAccount.find(
    { organizationId: opts.orgId, type: 'Current Asset (cash)' },
    { _id: 1 },
  ).lean<{ _id: Types.ObjectId }[]>();
  if (cashAccounts.length === 0) return new Set();

  const cashAccountIds = cashAccounts.map((a) => a._id);

  const dateClause: Record<string, Date> = {};
  if (opts.from) dateClause.$gte = opts.from;
  if (opts.to) dateClause.$lte = opts.to;

  const jeIds = await JournalEntry.find(
    {
      organizationId: opts.orgId,
      status: 'Posted',
      'lines.accountId': { $in: cashAccountIds },
      ...(opts.from || opts.to ? { date: dateClause } : {}),
    },
    { _id: 1 },
  ).lean<{ _id: Types.ObjectId }[]>();

  return new Set(jeIds.map((j) => String(j._id)));
}

/**
 * Generic filter — drops every row whose `journalEntryId` is NOT in the
 * pre-computed Set. Returns the unfiltered list when mode === 'accrual'.
 *
 * The row shape is intentionally loose: any object carrying a
 * `journalEntryId` (string or ObjectId) works. Reports flatten JE lines
 * into different projections, so the filter stays projection-agnostic.
 */
export function applyCashBasis<
  T extends { journalEntryId: string | Types.ObjectId },
>(rows: T[], mode: AccountingMode, cashJeIds: Set<string>): T[] {
  if (mode === 'accrual') return rows;
  return rows.filter((row) => cashJeIds.has(String(row.journalEntryId)));
}
