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
import { recurringTransactionUpdateSchemaChecked } from '@/lib/validation/pm/recurringTransaction';
import {
  mapAmountLineToDb,
  mapMortgageToDb,
  serializeAmountLine,
  serializeMortgage,
} from '../serialize';
import { computeWarnings, mergeWarnings } from '@/lib/pm/warnings';
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
    amounts: (doc.amounts ?? []).map(serializeAmountLine),
    mortgage: serializeMortgage(doc.mortgage),
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

  const parsed = recurringTransactionUpdateSchemaChecked.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // `mortgage` is pulled out with the other hand-mapped fields: it arrives in
  // dollars and must go through mapMortgageToDb, so Object.assign must never
  // see it.
  const {
    payee,
    bankAccountId,
    nextDate,
    amounts,
    mortgage,
    ...rest
  } = parsed.data;

  Object.assign(doc, rest);
  if (payee !== undefined) {
    doc.payee =
      payee && payee.id && payee.type
        ? { type: payee.type, id: new Types.ObjectId(payee.id) }
        : null;
  }
  if (bankAccountId !== undefined) {
    doc.bankAccountId = bankAccountId
      ? new Types.ObjectId(bankAccountId)
      : null;
  }
  if (nextDate !== undefined) {
    doc.nextDate = nextDate ? new Date(nextDate) : (null as unknown as Date);
    // The poster skips any rule whose `lastPostedDate >= nextDate` ("already
    // posted for this date"). Moving the next date back to or before the last
    // posting would therefore freeze the rule permanently — it would stay
    // "Active" in the UI while silently generating nothing, forever. Clearing
    // the stamp lets the rescheduled date fire. Past postings are untouched,
    // so this stays non-retroactive (BR-AC-8).
    if (
      doc.nextDate &&
      doc.lastPostedDate &&
      new Date(doc.lastPostedDate) >= new Date(doc.nextDate)
    ) {
      doc.lastPostedDate = null;
    }
  }
  if (amounts !== undefined) {
    doc.amounts = amounts.map(
      mapAmountLineToDb,
    ) as unknown as typeof doc.amounts;
  }
  // `mortgage: null` clears the terms; omitting the key leaves them alone, so a
  // partial PATCH from some other surface can't wipe a configured loan.
  if (mortgage !== undefined) {
    doc.mortgage = mapMortgageToDb(
      mortgage,
    ) as unknown as typeof doc.mortgage;
  }

  await doc.save();

  // Re-stamp warnings: an edit can introduce (or clear) an allocation that
  // targets a company with no eligible properties, and the poster reads these.
  doc.warnings = mergeWarnings(
    doc.warnings ?? [],
    computeWarnings(doc.toObject(), 'RecurringTransaction'),
  );
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
