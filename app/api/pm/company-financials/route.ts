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
  } | null>();
  const mode: AccountingMode = org?.accountingMode ?? 'accrual';

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
      { _id: 1, type: 1, name: 1 },
    ).lean<Array<{ _id: Types.ObjectId; type: string; name: string }>>(),
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

  for (const je of jes) {
    if (mode === 'cash' && !cashJeIds.has(String(je._id))) continue;

    const monthKey = startOfMonth(je.date).toISOString().slice(0, 7);
    const mbucket =
      monthly.get(monthKey) ?? { incomeCents: 0, expenseCents: 0 };

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
      if (acctType === 'Income') {
        const amount = (line.credit ?? 0) - (line.debit ?? 0);
        bucket.incomeCents += amount;
        mbucket.incomeCents += amount;
      } else if (acctType === 'Operating Expense') {
        const amount = (line.debit ?? 0) - (line.credit ?? 0);
        bucket.expenseCents += amount;
        mbucket.expenseCents += amount;
      }
      rollup.set(scopeKey, bucket);
    }
    monthly.set(monthKey, mbucket);
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

  // Sort monthly by key and emit `{ month, netCents }` for the chart.
  const monthlyBalances = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      netCents: v.incomeCents - v.expenseCents,
    }));

  return NextResponse.json({
    accountingMode: mode,
    from,
    to,
    companyCashCents,
    unpaidBillsCents,
    overdueBillsCount,
    netIncomeCents,
    companyOnly: {
      incomeCents: companyBucket.incomeCents,
      expenseCents: companyBucket.expenseCents,
    },
    propertyRollup,
    monthlyBalances,
  });
}
