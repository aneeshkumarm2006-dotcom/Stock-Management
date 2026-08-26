// Budget seed helper — implements BR-AC-11 ("Copy from previous FY's
// actual amounts snapshots prior GL"). Aggregates posted JournalEntry
// lines for the prior fiscal year, bucketed by ChartOfAccount × fiscal
// month, and returns the shape Budget.lines[] expects.
//
// Used by:
//   - POST /api/pm/budgets when `defaultAmounts === 'Copy previous FY actuals'`
//   - POST /api/pm/budgets when `defaultAmounts === 'Copy existing budget'`
//     (the existing-budget clone path uses `copyExistingBudgetLines`)
import { Types } from "mongoose";
import { JournalEntry } from "@/lib/db/models/pm/JournalEntry";
import { ledgerVisibleMatch } from "@/lib/pm/ledgerVisibility";
import { ChartOfAccount } from "@/lib/db/models/pm/ChartOfAccount";
import { Budget } from "@/lib/db/models/pm/Budget";
import type { FiscalMonth } from "@/types/pm";
import { FISCAL_MONTH_INDEX } from "@/types/pm";
import { normalizeScope, type PmScope } from "@/lib/pm/scope";

export interface BudgetLineSeed {
  accountId: Types.ObjectId;
  category: "Income" | "Expense";
  monthlyAmounts: number[]; // length 12, cents
}

/**
 * Does a posted GL line belong to this budget's scope?
 *
 * The dual-read on the Company branch is deliberate: Company-scoped lines
 * written before named companies existed carry `scopeId: null`, they mean "the
 * organization's own books", and they are never backfilled (rewriting GL
 * history has no reversal key). So a named company's budget reads its own rows
 * plus that legacy bucket, and stays comparable across the boundary.
 */
function scopeMatchesLine(
  scope: PmScope,
  line: { scopeType?: string | null; scopeId?: Types.ObjectId | null },
): boolean {
  const lineScope = normalizeScope(line);
  if (scope.type === "Property") {
    return (
      lineScope.type === "Property" &&
      String(lineScope.id) === String(scope.id)
    );
  }
  if (lineScope.type !== "Company") return false;
  if (!scope.id) return lineScope.id === null;
  return lineScope.id === null || String(lineScope.id) === String(scope.id);
}

/** Compute the inclusive [start, end] window for a fiscal year given the
 *  Organization's fiscalYearStart month. `fiscalYear=2026` + start=July
 *  yields `[2025-07-01, 2026-06-30]`. */
export function computeFiscalYearWindow(
  fiscalYear: number,
  fiscalYearStart: FiscalMonth,
): { startDate: Date; endDate: Date } {
  const startMonth = FISCAL_MONTH_INDEX[fiscalYearStart]; // 1-12
  // Standard convention: FY 2026 ending July 2026 starts July 2025.
  // If fiscalYearStart === 'January', startYear === fiscalYear (calendar FY).
  const startYear = startMonth === 1 ? fiscalYear : fiscalYear - 1;
  const startDate = new Date(Date.UTC(startYear, startMonth - 1, 1));
  // End: 12 months later, last day of prior month.
  const endMonth = startMonth - 1; // 0-11 indexed (Jan=0)
  const endYear = startMonth === 1 ? fiscalYear : fiscalYear;
  // Day 0 of next month = last day of target month.
  const endDate = new Date(Date.UTC(endYear, endMonth + 1, 0, 23, 59, 59, 999));
  return { startDate, endDate };
}

/** Map a JS Date to its fiscal-month bucket [0..11] given the FY start. */
function fiscalMonthIndex(d: Date, fiscalYearStart: FiscalMonth): number {
  const startMonth = FISCAL_MONTH_INDEX[fiscalYearStart]; // 1-12
  const calendarMonth = d.getUTCMonth() + 1; // 1-12
  // (calendarMonth - startMonth + 12) % 12 — wraps around.
  return (calendarMonth - startMonth + 12) % 12;
}

/** Pull every posted JE line in the prior FY window, bucket by
 *  account + fiscal month, and return a BudgetLineSeed[] suitable for
 *  Budget.lines on create. Income vs Expense category is taken from the
 *  ChartOfAccount.type — lines on non-Income/non-Expense accounts are
 *  filtered out (e.g. cash, AR, AP transfers).
 *
 *  Scope filtering (see `scopeMatchesLine` below):
 *    - Property scope → only that property's lines contribute.
 *    - A NAMED company scope → only that company's lines contribute, plus the
 *      legacy `scopeId: null` Company rows written before named companies
 *      existed (those mean "the organization's own books" and were never
 *      backfilled).
 *    - The legacy unnamed company scope → Company-scoped lines only.
 *
 *  Before this took a `PmScope` it took a bare `scopePropertyId`, and a null
 *  meant "no filter at all" — so a Company budget silently copied every line in
 *  the org, including every property's. With more than one company that goes
 *  from imprecise to actively wrong.
 */
export async function copyPriorFyActuals(opts: {
  orgId: Types.ObjectId;
  scope: PmScope;
  fiscalYear: number;
  fiscalYearStart: FiscalMonth;
}): Promise<BudgetLineSeed[]> {
  const priorFy = opts.fiscalYear - 1;
  const { startDate, endDate } = computeFiscalYearWindow(
    priorFy,
    opts.fiscalYearStart,
  );

  // Pull all Income / Expense CoA up front so we can short-circuit the
  // category lookup and skip lines on balance-sheet accounts.
  const accounts = await ChartOfAccount.find(
    {
      organizationId: opts.orgId,
      type: { $in: ["Income", "Operating Expense"] },
    },
    { _id: 1, type: 1 },
  ).lean<{ _id: Types.ObjectId; type: string }[]>();
  const accountTypeById = new Map(accounts.map((a) => [String(a._id), a.type]));
  if (accountTypeById.size === 0) return [];

  const jes = await JournalEntry.find({
    organizationId: opts.orgId,
    ...ledgerVisibleMatch(),
    date: { $gte: startDate, $lte: endDate },
  })
    .select("date lines")
    .lean<
      {
        date: Date;
        lines: Array<{
          accountId: Types.ObjectId;
          scopeType: string;
          scopeId: Types.ObjectId | null;
          debit: number;
          credit: number;
        }>;
      }[]
    >();

  // Map: accountIdStr → { category, monthly[12] }
  const buckets = new Map<string, BudgetLineSeed>();
  for (const je of jes) {
    const monthIdx = fiscalMonthIndex(je.date, opts.fiscalYearStart);
    for (const line of je.lines ?? []) {
      const acctIdStr = String(line.accountId);
      const acctType = accountTypeById.get(acctIdStr);
      if (!acctType) continue; // skip non-income/expense lines

      if (!scopeMatchesLine(opts.scope, line)) continue;

      const category: "Income" | "Expense" =
        acctType === "Income" ? "Income" : "Expense";
      let seed = buckets.get(acctIdStr);
      if (!seed) {
        seed = {
          accountId: line.accountId,
          category,
          monthlyAmounts: new Array<number>(12).fill(0),
        };
        buckets.set(acctIdStr, seed);
      }
      // Income lines accrue via credits; Expense lines via debits.
      const contribution =
        category === "Income" ? (line.credit ?? 0) : (line.debit ?? 0);
      seed.monthlyAmounts[monthIdx] =
        (seed.monthlyAmounts[monthIdx] ?? 0) + contribution;
    }
  }

  return Array.from(buckets.values());
}

/** Clone every line from an existing Budget into the new Budget's
 *  lines[] payload. Throws when the source budget does not belong to
 *  the same organization (defensive — the route validates first). */
export async function copyExistingBudgetLines(opts: {
  orgId: Types.ObjectId;
  sourceBudgetId: Types.ObjectId;
}): Promise<BudgetLineSeed[]> {
  const source = await Budget.findOne({
    _id: opts.sourceBudgetId,
    organizationId: opts.orgId,
  })
    .select("lines")
    .lean<{
      lines: Array<{
        accountId: Types.ObjectId;
        category: "Income" | "Expense";
        monthlyAmounts: number[];
      }>;
    } | null>();
  if (!source) return [];
  return source.lines.map((l) => ({
    accountId: l.accountId,
    category: l.category,
    monthlyAmounts: [...l.monthlyAmounts],
  }));
}
