// EFT approve — posts a JournalEntry (debit AP, credit bank cash CoA), sets
// status='Approved', stamps approverUserId, and locks the record.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EftRequest } from '@/lib/db/models/pm/EftRequest';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { Bill } from '@/lib/db/models/pm/Bill';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function resolveBankCashAccountId(
  orgObjectId: Types.ObjectId,
  bankAccountId: Types.ObjectId,
): Promise<Types.ObjectId | null> {
  const bank = await BankAccount.findOne({
    _id: bankAccountId,
    organizationId: orgObjectId,
  }).lean<{ chartOfAccountId?: Types.ObjectId | null } | null>();
  if (bank?.chartOfAccountId) return bank.chartOfAccountId;
  const fallback = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Operating Cash',
  }).lean<{ _id: Types.ObjectId } | null>();
  return fallback ? fallback._id : null;
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const eft = await EftRequest.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgObjectId,
  });
  if (!eft) {
    return NextResponse.json({ error: 'EFT not found' }, { status: 404 });
  }
  if (eft.status !== 'Pending') {
    return NextResponse.json(
      { error: `Cannot approve from status=${eft.status}` },
      { status: 409 },
    );
  }

  try {
    await assertWriteAllowed({
      orgId: ctx.orgId,
      txnDate: eft.date,
      ctx,
    });

    const ap = await ChartOfAccount.findOne({
      organizationId: orgObjectId,
      defaultFor: 'Accounts Payable',
    }).lean<{ _id: Types.ObjectId } | null>();
    if (!ap) {
      return NextResponse.json(
        { error: 'No Accounts Payable CoA configured for this org.' },
        { status: 400 },
      );
    }

    const cashCoA = await resolveBankCashAccountId(orgObjectId, eft.bankAccountId);
    if (!cashCoA) {
      return NextResponse.json(
        {
          error:
            'Bank account has no linked Chart of Accounts row and no Operating Cash default exists.',
        },
        { status: 400 },
      );
    }

    const je = await JournalEntry.create({
      organizationId: orgObjectId,
      date: eft.date,
      scopeType: 'Company',
      scopeId: null,
      memo: `EFT — ${eft.paidToName}`.slice(0, 256),
      lines: [
        {
          accountId: ap._id,
          scopeType: 'Company',
          scopeId: null,
          unitId: null,
          description: 'EFT clearing',
          debit: eft.amount,
          credit: 0,
        },
        {
          accountId: cashCoA,
          scopeType: 'Company',
          scopeId: null,
          unitId: null,
          description: 'Bank cash out (EFT)',
          debit: 0,
          credit: eft.amount,
        },
      ],
      status: 'Posted',
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    eft.status = 'Approved';
    eft.approverUserId = new Types.ObjectId(ctx.userId);
    eft.journalEntryId = je._id;
    await eft.save();

    // If linked to a Bill, roll up its status. (BillPayment is the typical
    // path; this branch covers EFTs that pay a Bill directly.)
    if (eft.billId) {
      const bill = await Bill.findOne({
        _id: eft.billId,
        organizationId: orgObjectId,
      });
      if (bill && bill.status !== 'Paid' && bill.status !== 'Voided') {
        bill.status = 'Paid';
        bill.paidDate = eft.date;
        await bill.save();
      }
    }

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'EftRequest',
      parentId: eft._id,
      eventType: 'EFT approved',
      actorUserId: ctx.userId,
      payload: { journalEntryId: String(je._id), amount: eft.amount },
    });

    return NextResponse.json({
      ok: true,
      status: eft.status,
      journalEntryId: String(je._id),
    });
  } catch (err) {
    if (err instanceof LockedPeriodError) {
      return NextResponse.json(
        { error: err.policyMessage, policyId: err.policyId },
        { status: 423 },
      );
    }
    const msg = err instanceof Error ? err.message : 'Failed to approve EFT';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
