// Financials P&L matrix endpoint (BR-AC-2, BR-AC-15).
//
// Returns rows = Income + Operating Expense CoA rows, columns = active
// Properties + a "Company" pseudo-property, cells = signed net (income shown
// positive, expense shown positive) for the period. Posted JEs only;
// `status === 'Voided'` excluded (the paired reversing JE neutralises any
// counted amount).
//
// Cash vs Accrual: the Phase 2 MVP returns the same matrix regardless — the
// toggle is mainly a placeholder so the UI surface exists. Phase 9 will
// refine cash-basis to "only count entries that hit a cash CoA"; until then
// both modes use the underlying ledger as-is. The org.accountingMode is still
// surfaced so the UI can display the active mode.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { Property } from '@/lib/db/models/pm/Property';
import { Organization } from '@/lib/db/models/pm/Organization';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

interface CellKey {
  accountId: string;
  propertyId: string; // or "company"
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const [org, accounts, properties] = await Promise.all([
    Organization.findById(orgObjectId).lean(),
    ChartOfAccount.find({
      organizationId: orgObjectId,
      active: true,
      type: { $in: ['Income', 'Operating Expense'] },
    })
      .sort({ type: 1, name: 1 })
      .lean(),
    Property.find({ organizationId: orgObjectId, active: true })
      .sort({ propertyName: 1 })
      .lean(),
  ]);

  const accountIds = accounts.map((a) => a._id);

  const dateClause: Record<string, Date> = {};
  if (from) dateClause.$gte = new Date(from);
  if (to) dateClause.$lte = new Date(to);

  const matchStage: Record<string, unknown> = {
    organizationId: orgObjectId,
    status: 'Posted',
  };
  if (Object.keys(dateClause).length > 0) matchStage.date = dateClause;

  const rows: { _id: { accountId: Types.ObjectId; scopeId: Types.ObjectId | null; scopeType: string }; net: number }[] =
    accountIds.length === 0
      ? []
      : await JournalEntry.aggregate([
          { $match: matchStage },
          { $unwind: '$lines' },
          { $match: { 'lines.accountId': { $in: accountIds } } },
          {
            $group: {
              _id: {
                accountId: '$lines.accountId',
                scopeId: '$lines.scopeId',
                scopeType: '$lines.scopeType',
              },
              net: { $sum: { $subtract: ['$lines.credit', '$lines.debit'] } },
            },
          },
        ]);

  // For Income (credit-natural), net = credit − debit reads positive when
  // money flowed in. For Operating Expense (debit-natural), reverse the sign
  // so expenses display positive too (matching Buildium P&L convention).
  const cells = new Map<string, number>();
  for (const row of rows) {
    const accountId = String(row._id.accountId);
    const accountType = accounts.find((a) => String(a._id) === accountId)?.type;
    const propertyId =
      row._id.scopeType === 'Property' && row._id.scopeId
        ? String(row._id.scopeId)
        : 'company';
    const signedNet = accountType === 'Operating Expense' ? -row.net : row.net;
    const key: CellKey = { accountId, propertyId };
    const k = `${key.accountId}|${key.propertyId}`;
    cells.set(k, (cells.get(k) ?? 0) + signedNet);
  }

  // Phase 9 (BR-AC-20) — surface HOA per-association groupings. Pull
  // associationName per active BankAccount; the page can use this to
  // render an "Associations" sub-total row. Only emitted when at least
  // one tag is set, so non-HOA orgs see no change.
  const banks = await BankAccount.find(
    { organizationId: orgObjectId, active: true },
    { _id: 1, associationName: 1 },
  ).lean<
    Array<{ _id: Types.ObjectId; associationName?: string | null }>
  >();
  const tagged = banks.filter((b) => b.associationName);
  const associationNames = Array.from(
    new Set(tagged.map((b) => b.associationName as string)),
  ).sort();

  // §6 — surface the org-level estimated income-tax rate so the page can render
  // a company-column-only derived tax footer (no GL write; matches the
  // company-financials report). Defaults 0 ⇒ the footer reads $0.
  const estimatedIncomeTaxRatePct = Math.min(
    100,
    Math.max(0, (org as { estimatedIncomeTaxRatePct?: number } | null)
      ?.estimatedIncomeTaxRatePct ?? 0),
  );

  return NextResponse.json({
    accountingMode: org?.accountingMode ?? 'accrual',
    estimatedIncomeTaxRatePct,
    accounts: accounts.map((a) => ({
      id: String(a._id),
      name: a.name,
      type: a.type,
    })),
    columns: [
      { id: 'company', name: 'Company' },
      ...properties.map((p) => ({
        id: String(p._id),
        name: p.propertyName,
      })),
    ],
    cells: Array.from(cells.entries()).map(([k, v]) => {
      const [accountId, propertyId] = k.split('|');
      return { accountId, propertyId, amount: v };
    }),
    associations: associationNames,
  });
}
