// Budget seed helpers (PDR §3.26, BR-AC-11). Translates a `defaultAmounts`
// choice into the initial Line array stored on the new Budget document.
//
// All amounts here are integer cents to match the persistence convention.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Budget, type IBudgetLine } from '@/lib/db/models/pm/Budget';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import type { BudgetLineCategory, FiscalMonth } from '@/types/pm';
import { FISCAL_MONTH_INDEX } from '@/types/pm';

export interface SeedArgs {
  orgId: string;
  scopeType: 'Property' | 'Company';
  scopeId: string;
  fiscalYear: number;
  fiscalYearStart: FiscalMonth;
  defaultAmounts: 'Zero' | 'Copy previous FY actuals' | 'Copy existing budget';
  copySourceBudgetId?: string | null;
}

const ZERO_MONTHS = (): number[] => Array(12).fill(0);

function fyDateRange(
  fiscalYear: number,
  fiscalYearStart: FiscalMonth,
): { startDate: Date; endDate: Date } {
  const m0 = FISCAL_MONTH_INDEX[fiscalYearStart] - 1; // 0-indexed
  const startDate = new Date(Date.UTC(fiscalYear, m0, 1));
  const endDate = new Date(Date.UTC(fiscalYear + 1, m0, 1));
  return { startDate, endDate };
}

/** Compute the FY date range driven by the chosen fiscalYearStart. */
export function getFiscalYearDateRange(
  fiscalYear: number,
  fiscalYearStart: FiscalMonth,
): { startDate: Date; endDate: Date } {
  return fyDateRange(fiscalYear, fiscalYearStart);
}

/** Default amounts = Zero — emit one zeroed line per Income/Expense CoA. */
async function seedZeroLines(orgObjectId: Types.ObjectId): Promise<IBudgetLine[]> {
  const accounts = await ChartOfAccount.find({
    organizationId: orgObjectId,
    active: true,
    type: { $in: ['Income', 'Operating Expense'] },
  })
    .lean<{ _id: Types.ObjectId; type: string }[]>();
  return accounts.map((a) => ({
    accountId: a._id,
    category: (a.type === 'Income'
      ? 'Income'
      : 'Expense') as BudgetLineCategory,
    monthlyAmounts: ZERO_MONTHS(),
  }));
}

/** Default amounts = Copy existing — clone an upstream budget's lines. */
async function seedFromBudget(
  orgObjectId: Types.ObjectId,
  sourceId: Types.ObjectId,
): Promise<IBudgetLine[]> {
  const source = await Budget.findOne({
    _id: sourceId,
    organizationId: orgObjectId,
  }).lean<{ lines: IBudgetLine[] } | null>();
  if (!source) return [];
  return source.lines.map((l) => ({
    accountId: l.accountId,
    category: l.category,
    monthlyAmounts: [...l.monthlyAmounts],
  }));
}

/** Default amounts = Copy previous FY actuals — aggregate the posted GL. */
async function seedFromPriorFY(
  orgObjectId: Types.ObjectId,
  scopeType: 'Property' | 'Company',
  scopeObjectId: Types.ObjectId,
  fiscalYear: number,
  fiscalYearStart: FiscalMonth,
): Promise<IBudgetLine[]> {
  const prior = fyDateRange(fiscalYear - 1, fiscalYearStart);

  const accounts = await ChartOfAccount.find({
    organizationId: orgObjectId,
    type: { $in: ['Income', 'Operating Expense'] },
  })
    .lean<{ _id: Types.ObjectId; type: string }[]>();

  const accountById = new Map(accounts.map((a) => [String(a._id), a]));

  // Aggregate JournalLines into 12 monthly buckets keyed by accountId. We
  // group on the JE's `date` month relative to the chosen fiscalYearStart.
  type Bucket = {
    accountId: string;
    fiscalMonthIndex: number;
    total: number;
  };

  const matchScope =
    scopeType === 'Property'
      ? { 'lines.scopeType': 'Property', 'lines.scopeId': scopeObjectId }
      : { 'lines.scopeType': 'Company', 'lines.scopeId': scopeObjectId };

  const rows: Bucket[] = await JournalEntry.aggregate([
    {
      $match: {
        organizationId: orgObjectId,
        status: 'Posted',
        date: { $gte: prior.startDate, $lt: prior.endDate },
      },
    },
    { $unwind: '$lines' },
    {
      $match: {
        ...matchScope,
        'lines.accountId': { $in: accounts.map((a) => a._id) },
      },
    },
    {
      $addFields: {
        // delta = months elapsed since FY start, mod 12, 0-indexed.
        fiscalMonthIndex: {
          $mod: [
            {
              $add: [
                {
                  $subtract: [
                    { $month: '$date' },
                    FISCAL_MONTH_INDEX[fiscalYearStart],
                  ],
                },
                12,
              ],
            },
            12,
          ],
        },
      },
    },
    {
      $group: {
        _id: {
          accountId: '$lines.accountId',
          fiscalMonthIndex: '$fiscalMonthIndex',
        },
        total: {
          $sum: { $subtract: ['$lines.credit', '$lines.debit'] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        accountId: '$_id.accountId',
        fiscalMonthIndex: '$_id.fiscalMonthIndex',
        total: 1,
      },
    },
  ]);

  // Build a 12-cell array per accountId. Income lines store credit-positive
  // (credit minus debit, which is already what we summed). Expense lines
  // flip the sign so a debit-side spend ends up positive in the budget grid.
  const byAccount = new Map<string, number[]>();
  for (const row of rows) {
    const acct = accountById.get(String(row.accountId));
    if (!acct) continue;
    const arr = byAccount.get(String(row.accountId)) ?? ZERO_MONTHS();
    const value =
      acct.type === 'Income' ? row.total : -row.total; // expenses: flip sign
    arr[row.fiscalMonthIndex] = (arr[row.fiscalMonthIndex] ?? 0) + value;
    byAccount.set(String(row.accountId), arr);
  }

  // Emit one line per known account (preserves a stable schema even when
  // some accounts had zero posted activity last year).
  return accounts.map((a) => ({
    accountId: a._id,
    category: (a.type === 'Income'
      ? 'Income'
      : 'Expense') as BudgetLineCategory,
    monthlyAmounts: byAccount.get(String(a._id)) ?? ZERO_MONTHS(),
  }));
}

/** Top-level entry point. */
export async function seedBudgetLines(args: SeedArgs): Promise<IBudgetLine[]> {
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(args.orgId);
  const scopeObjectId = new Types.ObjectId(args.scopeId);

  if (args.defaultAmounts === 'Copy existing budget' && args.copySourceBudgetId) {
    return seedFromBudget(orgObjectId, new Types.ObjectId(args.copySourceBudgetId));
  }
  if (args.defaultAmounts === 'Copy previous FY actuals') {
    return seedFromPriorFY(
      orgObjectId,
      args.scopeType,
      scopeObjectId,
      args.fiscalYear,
      args.fiscalYearStart,
    );
  }
  return seedZeroLines(orgObjectId);
}
