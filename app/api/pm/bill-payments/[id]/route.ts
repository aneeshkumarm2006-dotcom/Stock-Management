// Per-row read for BillPayment. Edits are intentionally limited: a posted
// payment is immutable from the ledger perspective. To "undo", void the
// underlying JE and create a corrective payment.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BillPayment } from '@/lib/db/models/pm/BillPayment';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  await connectToDatabase();
  const doc = await BillPayment.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    id: String(doc._id),
    billId: String(doc.billId),
    bankAccountId: doc.bankAccountId ? String(doc.bankAccountId) : null,
    paymentMethod: doc.paymentMethod,
    checkNumber: doc.checkNumber ?? '',
    amount: doc.amount,
    paidDate: doc.paidDate,
    journalEntryId: doc.journalEntryId ? String(doc.journalEntryId) : null,
  });
}
