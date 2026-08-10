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
import { mapAmountLineToDb, mapMortgageToDb } from './serialize';
import { logActivity } from '@/lib/pm/activity';
import { computeWarnings } from '@/lib/pm/warnings';
import {
  isPropertyScope,
  normalizeScope,
  scopeKey,
  scopeKeyOf,
} from '@/lib/pm/scope';
import { resolveScopeLabels } from '@/lib/pm/scopeQuery';

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
    scopeId?: Types.ObjectId | string | null;
    amount?: number;
    allocation?: { mode?: string } | null;
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
  labels: Map<string, { label: string }>,
):
  | { type: 'Company'; companyAccountId: string | null; companyName: string | null; split: boolean }
  | { type: 'Property'; propertyId: string; propertyName: string }
  | { type: 'Multiple'; count: number } {
  const rows = amounts ?? [];
  // Keyed through the shared scope module so two different companies are two
  // different scopes here, exactly as the poster sees them.
  const keys = new Set(rows.map((a) => scopeKeyOf(a)));
  if (keys.size > 1) return { type: 'Multiple', count: keys.size };

  const first = rows[0];
  const scope = normalizeScope(first ?? {});
  const key = scopeKey(scope);

  if (isPropertyScope(scope)) {
    return {
      type: 'Property',
      propertyId: String(scope.id),
      propertyName: labels.get(key)?.label ?? 'Unknown property',
    };
  }
  return {
    type: 'Company',
    companyAccountId: scope.id ? String(scope.id) : null,
    // null id keeps rendering the literal "Company", exactly as before.
    companyName: scope.id ? (labels.get(key)?.label ?? 'Unknown company') : null,
    split: rows.some((a) => a.allocation?.mode === 'CompanyProperties'),
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

  // Resolve every referenced scope label — properties AND companies — in one
  // batched pass rather than per row.
  const labels = await resolveScopeLabels(
    rows.flatMap((r) => r.amounts ?? []),
    ctx.orgId,
  );

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      type: r.type,
      scope: summariseScope(r.amounts, labels),
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
    amounts: (parsed.data.amounts ?? []).map(mapAmountLineToDb),
    mortgage: mapMortgageToDb(parsed.data.mortgage),
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
