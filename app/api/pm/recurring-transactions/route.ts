// RecurringTransaction CRUD (PDR §3.23). Edits are non-retroactive
// (BR-AC-8) — `lastPostedDate` and `postedCount` are read-only.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RecurringTransaction } from '@/lib/db/models/pm/RecurringTransaction';
import { Property } from '@/lib/db/models/pm/Property';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { recurringTransactionCreateSchema } from '@/lib/validation/pm/recurringTransaction';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';
import { computeWarnings } from '@/lib/pm/warnings';

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
  queueForPrinting?: boolean;
  lastPostedDate?: Date | null;
  amounts?: Array<{
    scopeType?: string | null;
    scopeId?: unknown;
    amount?: number;
  }>;
}

/**
 * Collapse a rule's per-line scopes into one label for the list.
 *
 * Mirrors the poster's grouping key exactly (a row counts as Property only
 * when it names a real property), so what the list says can never disagree
 * with what actually posts.
 */
function summariseScope(
  amounts: RtLeanLike['amounts'],
  propertyNames: Map<string, string>,
):
  | { type: 'Company' }
  | { type: 'Property'; propertyId: string; propertyName: string }
  | { type: 'Multiple'; count: number } {
  const keys = new Set(
    (amounts ?? []).map((a) =>
      a.scopeType === 'Property' && a.scopeId ? String(a.scopeId) : 'company',
    ),
  );
  if (keys.size > 1) return { type: 'Multiple', count: keys.size };
  const only = Array.from(keys)[0];
  if (!only || only === 'company') return { type: 'Company' };
  return {
    type: 'Property',
    propertyId: only,
    propertyName: propertyNames.get(only) ?? 'Unknown property',
  };
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

  // Resolve every referenced property name in one query rather than per row.
  const propertyIds = Array.from(
    new Set(
      rows.flatMap((r) =>
        (r.amounts ?? [])
          .filter((a) => a.scopeType === 'Property' && a.scopeId)
          .map((a) => String(a.scopeId)),
      ),
    ),
  );
  const propertyNames = new Map<string, string>();
  if (propertyIds.length > 0) {
    const props = await Property.find({
      _id: { $in: propertyIds.map((id) => new Types.ObjectId(id)) },
      organizationId: new Types.ObjectId(ctx.orgId),
    })
      .select({ propertyName: 1 })
      .lean<{ _id: Types.ObjectId; propertyName: string }[]>();
    for (const p of props) propertyNames.set(String(p._id), p.propertyName);
  }

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      type: r.type,
      scope: summariseScope(r.amounts, propertyNames),
      amount: (r.amounts ?? []).reduce((s, a) => s + (a.amount ?? 0), 0),
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
      queueForPrinting: Boolean(r.queueForPrinting),
      lastPostedDate: r.lastPostedDate ?? null,
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

  let nextDate: Date | null = null;
  if (parsed.data.nextDate) {
    nextDate = new Date(parsed.data.nextDate);
    if (Number.isNaN(nextDate.getTime())) {
      return NextResponse.json({ error: 'Invalid nextDate' }, { status: 400 });
    }
  }

  const doc = await RecurringTransaction.create({
    organizationId: orgObjectId,
    type: parsed.data.type ?? 'Check',
    payee:
      parsed.data.payee && parsed.data.payee.id
        ? {
            type: parsed.data.payee.type ?? 'Vendor',
            id: new Types.ObjectId(parsed.data.payee.id),
          }
        : null,
    bankAccountId: parsed.data.bankAccountId
      ? new Types.ObjectId(parsed.data.bankAccountId)
      : null,
    memo: parsed.data.memo,
    frequency: parsed.data.frequency ?? 'Monthly',
    nextDate,
    postNDaysInAdvance: parsed.data.postNDaysInAdvance,
    duration: parsed.data.duration,
    occurrenceCount: parsed.data.occurrenceCount ?? null,
    amounts: (parsed.data.amounts ?? []).map((a) => ({
      scopeType: a.scopeType,
      scopeId: a.scopeId ? new Types.ObjectId(a.scopeId) : null,
      unitId: a.unitId ? new Types.ObjectId(a.unitId) : null,
      accountId: a.accountId ? new Types.ObjectId(a.accountId) : null,
      description: a.description,
      refNo: a.refNo,
      amount: toCents(a.amount ?? 0),
    })),
    queueForPrinting: parsed.data.queueForPrinting ?? false,
    active: parsed.data.active ?? true,
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  const computed = computeWarnings(doc.toObject(), 'RecurringTransaction');
  if (computed.length > 0) {
    doc.warnings = computed;
    await doc.save();
  }

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
