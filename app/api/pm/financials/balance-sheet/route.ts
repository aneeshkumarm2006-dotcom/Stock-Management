// Balance Sheet — assets, liabilities and equity as at a single date.
//
// AS-OF, NOT A WINDOW. Unlike the P&L matrix (`from`..`to`), this is a point in
// time: every Posted journal entry dated on or before `asOf`, with no lower
// bound. That is what makes it the natural home for the mortgage principal —
// the P&L route hard-filters accounts to Income + Operating Expense, so a
// principal repayment posted to a Long-term Liability is invisible everywhere
// else in the app except the raw General Ledger.
//
// RETAINED EARNINGS IS COMPUTED. There are no closing entries anywhere in this
// codebase, so Equity accounts hold only what someone posted to them directly
// (owner contributions). Cumulative Income − Expense to `asOf` is therefore
// surfaced as an explicit computed line rather than as an account, and it is
// labelled that way so nobody hunts for a ledger row that does not exist.
//
// IT ALWAYS BALANCES — and that is the thing to be honest about.
// JournalEntry.pre('validate') enforces Σdebits === Σcredits on every entry and
// `type` is a required enum, so Assets − Liabilities − Equity − RetainedEarnings
// is identically zero in any single currency. The sheet cannot fail
// arithmetically. It can only be INCOMPLETE: opening balances (property cost
// basis, accumulated depreciation, the mortgage's opening balance, prior-year
// retained earnings) were never entered, and a line pointing at a deleted
// account drops out of the roll-up. Both are reported explicitly rather than
// papered over.
//
// CURRENCY. Every figure is a MoneyByCurrency resolved from each line's scope.
// Native columns are the truth; the converted total is labelled indicative,
// because a consolidated balance sheet translated at today's spot rate is not a
// real consolidated balance sheet (IAS 21 wants closing rate for monetary items
// and historical rate for equity). The balance check is asserted per currency,
// never on the converted column.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { Property } from '@/lib/db/models/pm/Property';
import { CompanyAccount } from '@/lib/db/models/pm/CompanyAccount';
import { Organization } from '@/lib/db/models/pm/Organization';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  resolveCompanyCurrency,
  resolvePropertyCurrency,
} from '@/lib/pm/currency';
import { addMoney, type MoneyByCurrency } from '@/lib/pm/moneyByCurrency';
import type { ChartOfAccountType, PmCurrency } from '@/types/pm';

export const runtime = 'nodejs';

/** Debit-natural: a debit increases the balance. */
const ASSET_TYPES: ChartOfAccountType[] = [
  'Current Asset (cash)',
  'Current Asset',
  'Fixed Asset',
];
/** Credit-natural: a credit increases the balance. */
const LIABILITY_TYPES: ChartOfAccountType[] = [
  'Current Liability',
  'Long-term Liability',
];
const EQUITY_TYPES: ChartOfAccountType[] = ['Equity'];
/** Excluded from the account roll-up; they drive the retained-earnings line. */
const PL_TYPES: ChartOfAccountType[] = ['Income', 'Operating Expense'];

interface AggRow {
  _id: {
    accountId: Types.ObjectId;
    scopeId: Types.ObjectId | null;
    scopeType: string;
  };
  debit: number;
  credit: number;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const asOfParam = searchParams.get('asOf');
  const asOf = asOfParam ? new Date(asOfParam) : new Date();
  if (Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: 'Invalid asOf date' }, { status: 400 });
  }
  // Inclusive of the whole day, matching the P&L's inclusive `to` boundary.
  asOf.setHours(23, 59, 59, 999);

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const [org, accounts, properties, companies] = await Promise.all([
    Organization.findById(orgObjectId)
      .select({ defaultCurrency: 1 })
      .lean<{ defaultCurrency?: PmCurrency } | null>(),
    // No `active: true` filter: an account deactivated after it was posted to
    // still holds a real balance, and dropping it would silently unbalance the
    // sheet. `active` is carried through so the UI can mark it.
    ChartOfAccount.find({ organizationId: orgObjectId })
      .select({ _id: 1, name: 1, type: 1, parentId: 1, isGroup: 1, active: 1 })
      .sort({ type: 1, name: 1 })
      .lean<
        Array<{
          _id: Types.ObjectId;
          name: string;
          type: ChartOfAccountType;
          parentId?: Types.ObjectId | null;
          isGroup?: boolean;
          active?: boolean;
        }>
      >(),
    Property.find({ organizationId: orgObjectId })
      .select({ _id: 1, currency: 1 })
      .lean<Array<{ _id: Types.ObjectId; currency?: PmCurrency | null }>>(),
    CompanyAccount.find({ organizationId: orgObjectId })
      .select({ _id: 1, currency: 1 })
      .lean<Array<{ _id: Types.ObjectId; currency?: PmCurrency | null }>>(),
  ]);

  const orgDefaultCurrency: PmCurrency = org?.defaultCurrency ?? 'USD';
  const propertyCurrency = new Map(
    properties.map((p) => [
      String(p._id),
      resolvePropertyCurrency(p.currency, orgDefaultCurrency),
    ]),
  );
  const companyCurrency = new Map(
    companies.map((c) => [
      String(c._id),
      resolveCompanyCurrency(c.currency, orgDefaultCurrency),
    ]),
  );
  /** A Company scope with no id is the org's own books. */
  const currencyForScope = (
    scopeType: string,
    scopeId: Types.ObjectId | null,
  ): PmCurrency => {
    if (scopeType === 'Property' && scopeId) {
      return propertyCurrency.get(String(scopeId)) ?? orgDefaultCurrency;
    }
    if (scopeId) {
      return companyCurrency.get(String(scopeId)) ?? orgDefaultCurrency;
    }
    return orgDefaultCurrency;
  };

  const accountById = new Map(accounts.map((a) => [String(a._id), a]));

  // One pass over the whole ledger up to `asOf`. Same shape the
  // outstanding-balances route already runs; the (organizationId, date) index
  // covers it.
  const rows: AggRow[] = await JournalEntry.aggregate([
    { $match: { organizationId: orgObjectId, status: 'Posted', date: { $lte: asOf } } },
    { $unwind: '$lines' },
    {
      $group: {
        _id: {
          accountId: '$lines.accountId',
          scopeId: '$lines.scopeId',
          scopeType: '$lines.scopeType',
        },
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);

  const balances = new Map<string, MoneyByCurrency>();
  const retainedEarnings: MoneyByCurrency = {};
  // A line pointing at a deleted chart-of-accounts row cannot be classified and
  // silently vanishes from the roll-up. Count it rather than lose it.
  let orphanLines = 0;
  const orphanTotals: MoneyByCurrency = {};

  for (const row of rows) {
    const accountId = String(row._id.accountId);
    const account = accountById.get(accountId);
    const cur = currencyForScope(row._id.scopeType, row._id.scopeId);
    const debitNet = (row.debit ?? 0) - (row.credit ?? 0);

    if (!account) {
      orphanLines += 1;
      addMoney(orphanTotals, cur, debitNet);
      continue;
    }

    if (PL_TYPES.includes(account.type)) {
      // Income is credit-natural, expense debit-natural; net income is
      // therefore the NEGATIVE of the debit-net across both.
      addMoney(retainedEarnings, cur, -debitNet);
      continue;
    }

    const signed = ASSET_TYPES.includes(account.type) ? debitNet : -debitNet;
    const acc = balances.get(accountId) ?? {};
    addMoney(acc, cur, signed);
    balances.set(accountId, acc);
  }

  const section = (types: ChartOfAccountType[]) =>
    accounts
      .filter((a) => types.includes(a.type) && !a.isGroup)
      .map((a) => ({
        id: String(a._id),
        name: a.name,
        type: a.type,
        active: a.active !== false,
        totals: balances.get(String(a._id)) ?? {},
      }))
      // Hide accounts that have never been touched — a chart with 40 unused
      // rows buries the handful that carry a balance.
      .filter((a) => Object.values(a.totals).some((v) => (v ?? 0) !== 0));

  const assets = section(ASSET_TYPES);
  const liabilities = section(LIABILITY_TYPES);
  const equityAccounts = section(EQUITY_TYPES);

  const sumSection = (
    rowsIn: Array<{ totals: MoneyByCurrency }>,
  ): MoneyByCurrency => {
    const out: MoneyByCurrency = {};
    for (const r of rowsIn) {
      for (const [cur, cents] of Object.entries(r.totals)) {
        addMoney(out, cur as PmCurrency, cents ?? 0);
      }
    }
    return out;
  };

  const totalAssets = sumSection(assets);
  const totalLiabilities = sumSection(liabilities);
  const equityFromAccounts = sumSection(equityAccounts);
  const totalEquity: MoneyByCurrency = {};
  for (const [cur, cents] of Object.entries(equityFromAccounts)) {
    addMoney(totalEquity, cur as PmCurrency, cents ?? 0);
  }
  for (const [cur, cents] of Object.entries(retainedEarnings)) {
    addMoney(totalEquity, cur as PmCurrency, cents ?? 0);
  }

  // Assets − (Liabilities + Equity), per currency. Expected to be exactly 0;
  // anything else means orphan lines, and the UI says so.
  const currencies = Array.from(
    new Set<PmCurrency>([
      ...(Object.keys(totalAssets) as PmCurrency[]),
      ...(Object.keys(totalLiabilities) as PmCurrency[]),
      ...(Object.keys(totalEquity) as PmCurrency[]),
    ]),
  ).sort((a, b) =>
    a === orgDefaultCurrency ? -1 : b === orgDefaultCurrency ? 1 : a.localeCompare(b),
  );

  const balanceCheck: MoneyByCurrency = {};
  for (const cur of currencies) {
    balanceCheck[cur] =
      (totalAssets[cur] ?? 0) -
      ((totalLiabilities[cur] ?? 0) + (totalEquity[cur] ?? 0));
  }

  return NextResponse.json({
    asOf: asOf.toISOString(),
    orgDefaultCurrency,
    currencies,
    assets,
    liabilities,
    equityAccounts,
    retainedEarnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanceCheck,
    orphanLines,
    orphanTotals,
  });
}
