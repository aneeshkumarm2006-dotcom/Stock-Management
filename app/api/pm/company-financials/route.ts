// GET /api/pm/company-financials — read-only aggregator that feeds the
// /properties/accounting/company-financials page (PDR §3.27, §3.28).
//
// Returns:
//   - companyCashCents (sum of `isCompanyCash` BankAccount balances —
//     reuses the existing bank-balance roll-up helper)
//   - unpaidBillsCents + overdueBillsCount
//   - netIncomeCents over the requested window (cash- or accrual-mode)
//   - propertyRollup[] (per-Property income / expense / net)
//   - monthlyBalances[] (chart series — net by month within the window)
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { Bill } from '@/lib/db/models/pm/Bill';
import { Organization } from '@/lib/db/models/pm/Organization';
import { Property } from '@/lib/db/models/pm/Property';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { computeBankRollups } from '@/lib/pm/bankBalances';
import { collectCashJournalEntryIds } from '@/lib/pm/cashBasisFilter';
import type { AccountingMode } from '@/types/pm';

export const runtime = 'nodejs';

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const today = new Date();
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const from = fromParam ? new Date(fromParam) : new Date(today.getFullYear(), 0, 1);
  const to = toParam ? new Date(toParam) : today;

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const org = await Organization.findById(orgObjectId).lean<{
    accountingMode: AccountingMode;
    defaultCurrency?: 'USD' | 'CAD';
    estimatedIncomeTaxRatePct?: number;
  } | null>();
  const mode: AccountingMode = org?.accountingMode ?? 'accrual';
  const defaultCurrency: 'USD' | 'CAD' = org?.defaultCurrency ?? 'USD';
  // §6 — per-company estimated income-tax rate (0C). Clamp to [0, 100].
  const estimatedIncomeTaxRatePct = Math.min(
    100,
    Math.max(0, org?.estimatedIncomeTaxRatePct ?? 0),
  );

  const cashJeIds =
    mode === 'cash'
      ? await collectCashJournalEntryIds({
          orgId: orgObjectId,
          from,
          to,
        })
      : new Set<string>();
  void cashJeIds; // referenced below

  const [accounts, banks, properties, openBills, jes] = await Promise.all([
    ChartOfAccount.find(
      {
        organizationId: orgObjectId,
        type: { $in: ['Income', 'Operating Expense'] },
      },
      { _id: 1, type: 1, name: 1, parentId: 1, defaultFor: 1 },
    ).lean<
      Array<{
        _id: Types.ObjectId;
        type: string;
        name: string;
        parentId?: Types.ObjectId | null;
        defaultFor?: string | null;
      }>
    >(),
    BankAccount.find(
      { organizationId: orgObjectId, active: true, isCompanyCash: true },
      { _id: 1, name: 1, chartOfAccountId: 1 },
    ).lean<Array<{ _id: Types.ObjectId; name: string; chartOfAccountId?: Types.ObjectId | null }>>(),
    Property.find(
      { organizationId: orgObjectId, active: true },
      { _id: 1, propertyName: 1 },
    ).lean<Array<{ _id: Types.ObjectId; propertyName: string }>>(),
    Bill.find(
      {
        organizationId: orgObjectId,
        status: { $in: ['Due', 'Overdue', 'Partially paid'] },
      },
      { _id: 1, amount: 1, status: 1 },
    ).lean<Array<{ _id: Types.ObjectId; amount: number; status: string }>>(),
    JournalEntry.find({
      organizationId: orgObjectId,
      status: 'Posted',
      date: { $gte: from, $lte: to },
    })
      .select('date lines')
      .lean<
        Array<{
          _id: Types.ObjectId;
          date: Date;
          lines: Array<{
            accountId: Types.ObjectId;
            scopeType: string;
            scopeId: Types.ObjectId | null;
            debit: number;
            credit: number;
          }>;
        }>
      >(),
  ]);

  // Company cash hero — sum live balances of every isCompanyCash bank.
  const bankRollups = await computeBankRollups(
    ctx.orgId,
    banks.map((b) => b._id),
  );
  let companyCashCents = 0;
  for (const bank of banks) {
    companyCashCents += bankRollups.get(String(bank._id))?.balance ?? 0;
  }

  // Bills hero.
  let unpaidBillsCents = 0;
  let overdueBillsCount = 0;
  for (const b of openBills) {
    unpaidBillsCents += b.amount ?? 0;
    if (b.status === 'Overdue') overdueBillsCount += 1;
  }

  // Income / expense / property roll-up.
  const accountTypeById = new Map(
    accounts.map((a) => [String(a._id), a.type]),
  );

  // §6 — Investment revenue is addressed BY ROLE, not by a fragile name match.
  // The seeded Investment Income group carries `defaultFor: 'Investment Income'`
  // (0B); the postable leaves are its children. Build the set of account ids
  // whose income should count as "Investment revenue" = the group + its leaves.
  const investmentGroup = accounts.find(
    (a) => a.defaultFor === 'Investment Income',
  );
  const investmentAccountIds = new Set<string>();
  if (investmentGroup) {
    investmentAccountIds.add(String(investmentGroup._id));
    for (const a of accounts) {
      if (a.parentId && String(a.parentId) === String(investmentGroup._id)) {
        investmentAccountIds.add(String(a._id));
      }
    }
  }
  let investmentRevenueCents = 0;
  const propertyNameById = new Map(
    properties.map((p) => [String(p._id), p.propertyName] as const),
  );

  const rollup = new Map<
    string,
    { incomeCents: number; expenseCents: number }
  >();
  rollup.set('__company__', { incomeCents: 0, expenseCents: 0 });
  for (const p of properties) {
    rollup.set(String(p._id), { incomeCents: 0, expenseCents: 0 });
  }

  // Monthly chart series.
  const monthly = new Map<string, { incomeCents: number; expenseCents: number }>();

  // Year-over-year series: company-wide annual totals + per-scope annual totals
  // (keyed by year, then by property/company scope) for the YoY pivot.
  const annual = new Map<number, { incomeCents: number; expenseCents: number }>();
  const annualByScope = new Map<
    string,
    Map<number, { incomeCents: number; expenseCents: number }>
  >();

  for (const je of jes) {
    if (mode === 'cash' && !cashJeIds.has(String(je._id))) continue;

    const monthKey = startOfMonth(je.date).toISOString().slice(0, 7);
    const mbucket =
      monthly.get(monthKey) ?? { incomeCents: 0, expenseCents: 0 };

    // Company-wide annual bucket for this JE's calendar year.
    const year = je.date.getUTCFullYear();
    const abucket = annual.get(year) ?? { incomeCents: 0, expenseCents: 0 };

    for (const line of je.lines) {
      const acctType = accountTypeById.get(String(line.accountId));
      if (!acctType) continue;
      const scopeKey =
        line.scopeType === 'Property' && line.scopeId
          ? String(line.scopeId)
          : '__company__';
      const bucket = rollup.get(scopeKey) ?? {
        incomeCents: 0,
        expenseCents: 0,
      };
      // Per-scope annual bucket (property/company × year).
      let scopeYears = annualByScope.get(scopeKey);
      if (!scopeYears) {
        scopeYears = new Map();
        annualByScope.set(scopeKey, scopeYears);
      }
      const sybucket = scopeYears.get(year) ?? {
        incomeCents: 0,
        expenseCents: 0,
      };
      if (acctType === 'Income') {
        const amount = (line.credit ?? 0) - (line.debit ?? 0);
        bucket.incomeCents += amount;
        mbucket.incomeCents += amount;
        abucket.incomeCents += amount;
        sybucket.incomeCents += amount;
        if (investmentAccountIds.has(String(line.accountId))) {
          investmentRevenueCents += amount;
        }
      } else if (acctType === 'Operating Expense') {
        const amount = (line.debit ?? 0) - (line.credit ?? 0);
        bucket.expenseCents += amount;
        mbucket.expenseCents += amount;
        abucket.expenseCents += amount;
        sybucket.expenseCents += amount;
      }
      rollup.set(scopeKey, bucket);
      scopeYears.set(year, sybucket);
    }
    monthly.set(monthKey, mbucket);
    annual.set(year, abucket);
  }

  const propertyRollup = Array.from(rollup.entries())
    .filter(([k]) => k !== '__company__')
    .map(([k, v]) => ({
      propertyId: k,
      propertyName: propertyNameById.get(k) ?? 'Unknown',
      incomeCents: v.incomeCents,
      expenseCents: v.expenseCents,
      netCents: v.incomeCents - v.expenseCents,
    }));

  const companyBucket = rollup.get('__company__') ?? {
    incomeCents: 0,
    expenseCents: 0,
  };
  const netIncomeCents =
    propertyRollup.reduce((s, p) => s + p.netCents, 0) +
    (companyBucket.incomeCents - companyBucket.expenseCents);

  // §6 — total revenue = rent (+ other ordinary income) + investment revenue.
  // `rentalRevenueCents` is "everything that isn't investment income" so the UI
  // can show the two side by side; their sum is `totalRevenueCents`.
  const totalRevenueCents =
    propertyRollup.reduce((s, p) => s + p.incomeCents, 0) +
    companyBucket.incomeCents;
  const rentalRevenueCents = totalRevenueCents - investmentRevenueCents;

  // §6 — estimated income taxes is a DERIVED display line (no GL write). Apply
  // the org-level rate to positive net income only; afterTaxNet nets it out.
  const estimatedIncomeTaxCents = Math.round(
    (Math.max(0, netIncomeCents) * estimatedIncomeTaxRatePct) / 100,
  );
  const afterTaxNetCents = netIncomeCents - estimatedIncomeTaxCents;

  // Sort monthly by key and emit `{ month, netCents }` for the chart.
  const monthlyBalances = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      netCents: v.incomeCents - v.expenseCents,
    }));

  // Year-over-year — company-wide annual totals, ascending by year.
  const annualBalances = Array.from(annual.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, v]) => ({
      year,
      incomeCents: v.incomeCents,
      expenseCents: v.expenseCents,
      netCents: v.incomeCents - v.expenseCents,
    }));
  const years = annualBalances.map((a) => a.year);

  // Per-property net by year for the YoY pivot. Mirrors `propertyRollup` —
  // every active property is included (missing years render as $0 client-side).
  const propertyAnnual: Array<{
    propertyId: string;
    propertyName: string;
    byYear: Record<
      string,
      { incomeCents: number; expenseCents: number; netCents: number }
    >;
  }> = properties.map((p) => {
    const scopeYears = annualByScope.get(String(p._id));
    const byYear: Record<
      string,
      { incomeCents: number; expenseCents: number; netCents: number }
    > = {};
    if (scopeYears) {
      for (const [yr, v] of Array.from(scopeYears.entries())) {
        byYear[String(yr)] = {
          incomeCents: v.incomeCents,
          expenseCents: v.expenseCents,
          netCents: v.incomeCents - v.expenseCents,
        };
      }
    }
    return {
      propertyId: String(p._id),
      propertyName: propertyNameById.get(String(p._id)) ?? 'Unknown',
      byYear,
    };
  });

  // Company-scoped activity appears as its own row only when it carries values.
  const companyScopeYears = annualByScope.get('__company__');
  if (companyScopeYears) {
    const byYear: Record<
      string,
      { incomeCents: number; expenseCents: number; netCents: number }
    > = {};
    let hasActivity = false;
    for (const [yr, v] of Array.from(companyScopeYears.entries())) {
      if (v.incomeCents !== 0 || v.expenseCents !== 0) hasActivity = true;
      byYear[String(yr)] = {
        incomeCents: v.incomeCents,
        expenseCents: v.expenseCents,
        netCents: v.incomeCents - v.expenseCents,
      };
    }
    if (hasActivity) {
      propertyAnnual.push({
        propertyId: '__company__',
        propertyName: 'Company-scoped',
        byYear,
      });
    }
  }

  return NextResponse.json({
    accountingMode: mode,
    defaultCurrency,
    from,
    to,
    companyCashCents,
    unpaidBillsCents,
    overdueBillsCount,
    netIncomeCents,
    // §6 — additive reporting fields. `totalRevenueCents = rental + investment`.
    totalRevenueCents,
    rentalRevenueCents,
    investmentRevenueCents,
    estimatedIncomeTaxRatePct,
    estimatedIncomeTaxCents,
    afterTaxNetCents,
    companyOnly: {
      incomeCents: companyBucket.incomeCents,
      expenseCents: companyBucket.expenseCents,
    },
    propertyRollup,
    monthlyBalances,
    // Year-over-year reporting fields (additive).
    years,
    annualBalances,
    propertyAnnual,
  });
}
