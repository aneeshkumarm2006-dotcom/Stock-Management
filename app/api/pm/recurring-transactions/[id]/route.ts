// Per-row CRUD on RecurringTransaction. Edits never rewrite history
// (BR-AC-8); only the rule's future behaviour changes.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RecurringTransaction } from '@/lib/db/models/pm/RecurringTransaction';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { recurringTransactionUpdateSchema } from '@/lib/validation/pm/recurringTransaction';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return RecurringTransaction.findOne({
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
    type: doc.type,
    payee: doc.payee
      ? { type: doc.payee.type, id: String(doc.payee.id) }
      : null,
    bankAccountId: doc.bankAccountId ? String(doc.bankAccountId) : null,
    memo: doc.memo ?? '',
    frequency: doc.frequency,
    nextDate: doc.nextDate,
    postNDaysInAdvance: doc.postNDaysInAdvance,
    duration: doc.duration,
    occurrenceCount: doc.occurrenceCount ?? null,
    remainingOccurrences:
      typeof doc.occurrenceCount === 'number'
        ? Math.max(0, doc.occurrenceCount - doc.postedCount)
        : null,
    amounts: (doc.amounts ?? []).map((a) => ({
      scopeType: a.scopeType,
      scopeId: a.scopeId ? String(a.scopeId) : null,
      unitId: a.unitId ? String(a.unitId) : null,
      accountId: String(a.accountId),
      description: a.description ?? '',
      refNo: a.refNo ?? '',
      amount: a.amount,
    })),
    queueForPrinting: doc.queueForPrinting,
    active: doc.active,
    postedCount: doc.postedCount,
    lastPostedDate: doc.lastPostedDate ?? null,
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

  const parsed = recurringTransactionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const {
    payee,
    bankAccountId,
    nextDate,
    amounts,
    ...rest
  } = parsed.data;

  Object.assign(doc, rest);
  if (payee !== undefined) {
    doc.payee = payee
      ? { type: payee.type, id: new Types.ObjectId(payee.id) }
      : null;
  }
  if (bankAccountId !== undefined) {
    doc.bankAccountId = bankAccountId
      ? new Types.ObjectId(bankAccountId)
      : null;
  }
  if (nextDate !== undefined) doc.nextDate = new Date(nextDate);
  if (amounts !== undefined) {
    doc.amounts = amounts.map((a) => ({
      scopeType: a.scopeType,
      scopeId: a.scopeId ? new Types.ObjectId(a.scopeId) : null,
      unitId: a.unitId ? new Types.ObjectId(a.unitId) : null,
      accountId: new Types.ObjectId(a.accountId),
      description: a.description,
      refNo: a.refNo,
      amount: toCents(a.amount),
    }));
  }

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'RecurringTransaction',
    parentId: doc._id,
    eventType: 'Recurring transaction updated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  doc.active = false;
  await doc.save();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'RecurringTransaction',
    parentId: doc._id,
    eventType: 'Recurring transaction cancelled',
    actorUserId: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
