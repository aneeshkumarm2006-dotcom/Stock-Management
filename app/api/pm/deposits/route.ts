// Deposit CRUD (PDR §3.20, BR-AC-6, BR-AC-7, BR-AC-14).
// POST: validate → lock-check → create Deposit → synthesize the underlying JE
// (debit BankAccount's CoA cash account, credit each line's accountId) →
// back-link `journalEntryId` on the Deposit.
//
// The bank account → CoA mapping is consulted via BankAccount.chartOfAccountId
// (Phase 2 field). When unset, we fall back to the org's `Operating Cash`
// default-for CoA row; if THAT is missing (unusual — system-seeded by Phase 1),
// the route refuses to post with a clear error so the user can fix the
// mapping before money lands somewhere wrong.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Deposit } from '@/lib/db/models/pm/Deposit';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { depositCreateSchema } from '@/lib/validation/pm/deposit';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';

export const runtime = 'nodejs';

export function serializeDeposit(d: Record<string, unknown>) {
  const items = (d.depositItems as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(d._id),
    bankAccountId: String(d.bankAccountId),
    date: d.date instanceof Date ? d.date.toISOString() : String(d.date),
    memo: (d.memo as string) ?? '',
    totalAmount: Number(d.totalAmount ?? 0),
    depositItems: items.map((i) => ({
      scopeType: i.scopeType as 'Property' | 'Company',
      scopeId: i.scopeId ? String(i.scopeId) : null,
      unitId: i.unitId ? String(i.unitId) : null,
      accountId: String(i.accountId),
      description: (i.description as string) ?? '',
      refNo: (i.refNo as string) ?? '',
      amount: Number(i.amount ?? 0),
    })),
    attachmentFileId: d.attachmentFileId ? String(d.attachmentFileId) : null,
    journalEntryId: d.journalEntryId ? String(d.journalEntryId) : null,
    status: d.status as 'Posted' | 'Voided',
    createdAt:
      d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
  };
}

async function resolveBankCashAccountId(
  orgObjectId: Types.ObjectId,
  bankAccountId: Types.ObjectId,
): Promise<Types.ObjectId | null> {
  const bank = await BankAccount.findOne({
    _id: bankAccountId,
    organizationId: orgObjectId,
  }).lean();
  if (!bank) return null;
  if (bank.chartOfAccountId) return bank.chartOfAccountId;
  const fallback = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Operating Cash',
  }).lean();
  return fallback ? fallback._id : null;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const bankAccountId = searchParams.get('bankAccountId');
  const includeVoided = searchParams.get('includeVoided') === '1';

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeVoided) filter.status = { $ne: 'Voided' };
  if (bankAccountId && Types.ObjectId.isValid(bankAccountId)) {
    filter.bankAccountId = new Types.ObjectId(bankAccountId);
  }

  const rows = await Deposit.find(filter).sort({ date: -1 }).lean();
  return NextResponse.json(rows.map((r) => serializeDeposit(r as Record<string, unknown>)));
}

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = depositCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const txnDate = new Date(parsed.data.date);
  if (Number.isNaN(txnDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  // Lock-check the deposit-level scope plus each per-property line.
  try {
    await assertWriteAllowed({ orgId: ctx.orgId, txnDate, ctx });
    for (const item of parsed.data.depositItems) {
      if (item.scopeType === 'Property' && item.scopeId) {
        await assertWriteAllowed({
          orgId: ctx.orgId,
          txnDate,
          scopePropertyId: item.scopeId,
          ctx,
        });
      }
    }
  } catch (err) {
    if (err instanceof LockedPeriodError) {
      return NextResponse.json(
        { error: err.policyMessage, policyId: err.policyId },
        { status: 423 },
      );
    }
    throw err;
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const bankObjectId = new Types.ObjectId(parsed.data.bankAccountId);

  const bankCashAccountId = await resolveBankCashAccountId(orgObjectId, bankObjectId);
  if (!bankCashAccountId) {
    return NextResponse.json(
      {
        error:
          'Bank account has no linked Chart of Accounts row and no Operating Cash default exists. Set chartOfAccountId on the bank account before recording deposits.',
      },
      { status: 400 },
    );
  }

  const itemsCents = parsed.data.depositItems.map((i) => ({
    scopeType: i.scopeType,
    scopeId: i.scopeId ? new Types.ObjectId(i.scopeId) : null,
    unitId: i.unitId ? new Types.ObjectId(i.unitId) : null,
    accountId: new Types.ObjectId(i.accountId),
    description: i.description,
    refNo: i.refNo,
    amount: toCents(i.amount),
  }));
  const total = itemsCents.reduce((s, i) => s + i.amount, 0);

  // Build the matching JE: one debit to the bank's cash CoA, one credit per
  // deposit item to its target account.
  const jeLines = [
    {
      accountId: bankCashAccountId,
      scopeType: 'Company' as const,
      scopeId: null,
      unitId: null,
      name: undefined,
      description: 'Deposit: cash received',
      debit: total,
      credit: 0,
    },
    ...itemsCents.map((i) => ({
      accountId: i.accountId,
      scopeType: i.scopeType,
      scopeId: i.scopeId,
      unitId: i.unitId,
      name: undefined,
      description: i.description ?? '',
      debit: 0,
      credit: i.amount,
    })),
  ];

  try {
    const je = await JournalEntry.create({
      organizationId: orgObjectId,
      date: txnDate,
      scopeType: 'Company',
      scopeId: null,
      memo: parsed.data.memo
        ? `Deposit — ${parsed.data.memo}`.slice(0, 256)
        : 'Deposit',
      attachmentFileId: parsed.data.attachmentFileId
        ? new Types.ObjectId(parsed.data.attachmentFileId)
        : null,
      lines: jeLines,
      status: 'Posted',
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    const deposit = await Deposit.create({
      organizationId: orgObjectId,
      bankAccountId: bankObjectId,
      date: txnDate,
      memo: parsed.data.memo,
      depositItems: itemsCents,
      attachmentFileId: parsed.data.attachmentFileId
        ? new Types.ObjectId(parsed.data.attachmentFileId)
        : null,
      journalEntryId: je._id,
      status: 'Posted',
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Deposit',
      parentId: deposit._id,
      eventType: 'Deposit posted',
      actorUserId: ctx.userId,
      payload: {
        bankAccountId: String(bankObjectId),
        journalEntryId: String(je._id),
        totalAmount: deposit.totalAmount,
        itemCount: deposit.depositItems.length,
      },
    });

    return NextResponse.json(
      serializeDeposit(deposit.toObject() as unknown as Record<string, unknown>),
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to record deposit';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
