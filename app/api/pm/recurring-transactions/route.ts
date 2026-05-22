// RecurringTransaction CRUD (PDR §3.23). Edits are non-retroactive
// (BR-AC-8) — `lastPostedDate` and `postedCount` are read-only.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RecurringTransaction } from '@/lib/db/models/pm/RecurringTransaction';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { recurringTransactionCreateSchema } from '@/lib/validation/pm/recurringTransaction';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface RtLeanLike {
  _id: unknown;
  type: string;
  payee?: { type: string; id: unknown } | null;
  frequency: string;
  nextDate: Date;
  postNDaysInAdvance: number;
  duration: string;
  active: boolean;
  postedCount: number;
  occurrenceCount?: number | null;
  memo?: string;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === '1';

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeInactive) filter.active = true;

  const rows = await RecurringTransaction.find(filter)
    .sort({ nextDate: 1 })
    .lean<RtLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      type: r.type,
      payee: r.payee
        ? { type: r.payee.type, id: String(r.payee.id) }
        : null,
      frequency: r.frequency,
      nextDate: r.nextDate,
      postNDaysInAdvance: r.postNDaysInAdvance,
      duration: r.duration,
      occurrenceCount: r.occurrenceCount ?? null,
      remainingOccurrences:
        typeof r.occurrenceCount === 'number'
          ? Math.max(0, r.occurrenceCount - r.postedCount)
          : null,
      memo: r.memo ?? '',
      active: r.active,
      postedCount: r.postedCount,
    })),
  );
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

  const parsed = recurringTransactionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const nextDate = new Date(parsed.data.nextDate);
  if (Number.isNaN(nextDate.getTime())) {
    return NextResponse.json({ error: 'Invalid nextDate' }, { status: 400 });
  }

  const doc = await RecurringTransaction.create({
    organizationId: orgObjectId,
    type: parsed.data.type,
    payee: parsed.data.payee
      ? { type: parsed.data.payee.type, id: new Types.ObjectId(parsed.data.payee.id) }
      : null,
    bankAccountId: parsed.data.bankAccountId
      ? new Types.ObjectId(parsed.data.bankAccountId)
      : null,
    memo: parsed.data.memo,
    frequency: parsed.data.frequency,
    nextDate,
    postNDaysInAdvance: parsed.data.postNDaysInAdvance,
    duration: parsed.data.duration,
    occurrenceCount: parsed.data.occurrenceCount ?? null,
    amounts: parsed.data.amounts.map((a) => ({
      scopeType: a.scopeType,
      scopeId: a.scopeId ? new Types.ObjectId(a.scopeId) : null,
      unitId: a.unitId ? new Types.ObjectId(a.unitId) : null,
      accountId: new Types.ObjectId(a.accountId),
      description: a.description,
      refNo: a.refNo,
      amount: toCents(a.amount),
    })),
    queueForPrinting: parsed.data.queueForPrinting ?? false,
    active: parsed.data.active ?? true,
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'RecurringTransaction',
    parentId: doc._id,
    eventType: 'Recurring transaction created',
    actorUserId: ctx.userId,
    payload: { type: doc.type, frequency: doc.frequency },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
