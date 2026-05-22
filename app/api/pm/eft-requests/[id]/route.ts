// Per-row CRUD on EftRequest. Approved EFTs are immutable (§3.24); PATCH
// returns 409 with "must void first" once status='Approved'.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EftRequest } from '@/lib/db/models/pm/EftRequest';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { eftRequestUpdateSchema } from '@/lib/validation/pm/eftRequest';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return EftRequest.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    id: String(doc._id),
    date: doc.date,
    bankAccountId: String(doc.bankAccountId),
    paidToName: doc.paidToName,
    payee: { type: doc.payee.type, id: String(doc.payee.id) },
    propertiesScope: doc.propertiesScope ?? '',
    status: doc.status,
    approverUserId: doc.approverUserId ? String(doc.approverUserId) : null,
    amount: doc.amount,
    journalEntryId: doc.journalEntryId ? String(doc.journalEntryId) : null,
    rejectionReason: doc.rejectionReason ?? '',
    billId: doc.billId ? String(doc.billId) : null,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = eftRequestUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // §3.24 — Approved EFTs are immutable. Reject is a separate route.
  if (doc.status === 'Approved') {
    return NextResponse.json(
      {
        error:
          'EFT is approved and immutable. Void the underlying JE first to make changes.',
      },
      { status: 409 },
    );
  }
  if (doc.status === 'Rejected') {
    return NextResponse.json(
      { error: 'EFT has been rejected and cannot be edited.' },
      { status: 409 },
    );
  }

  const {
    date,
    bankAccountId,
    payee,
    amount,
    billId,
    ...rest
  } = parsed.data;

  Object.assign(doc, rest);
  if (date !== undefined) doc.date = new Date(date);
  if (bankAccountId !== undefined) {
    doc.bankAccountId = new Types.ObjectId(bankAccountId);
  }
  if (payee !== undefined) {
    doc.payee = { type: payee.type, id: new Types.ObjectId(payee.id) };
  }
  if (amount !== undefined) doc.amount = toCents(amount);
  if (billId !== undefined) {
    doc.billId = billId ? new Types.ObjectId(billId) : null;
  }

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EftRequest',
    parentId: doc._id,
    eventType: 'EFT request updated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
