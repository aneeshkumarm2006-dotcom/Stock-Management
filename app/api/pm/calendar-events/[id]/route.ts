// Per-row CalendarEvent CRUD (Phase 7 — PDR_MASTER §3.34).
//
// Recurring-event edit semantics (DECISIONS [G-B-13]):
//   - PATCH/DELETE accept `editScope: 'instance' | 'series'`.
//   - On `instance`, the master row gets an entry in `recurrenceExclusions`
//     for the targeted occurrence's start, and a NEW non-recurring row
//     is created carrying the mutation. The new row's recurrenceParentId
//     points back at the master so audit-log can reconcile.
//   - On `series` (default for masters), the master is mutated in place.
// Timezone is immutable per BR-CC-9; `propertyId` is immutable per
// BR-CC-6 (single-property scope at creation — multi-property = N events).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CalendarEvent } from '@/lib/db/models/pm/CalendarEvent';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  calendarEventUpdateSchema,
  calendarEventDeleteQuerySchema,
} from '@/lib/validation/pm/calendarEvent';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return CalendarEvent.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    id: String(doc._id),
    propertyId: String(doc.propertyId),
    eventName: doc.eventName,
    description: doc.description ?? '',
    startDate: doc.startDate,
    endDate: doc.endDate,
    allDay: doc.allDay,
    timezone: doc.timezone,
    repeat: doc.repeat,
    recurrenceRule: doc.recurrenceRule ?? '',
    recurrenceParentId: doc.recurrenceParentId
      ? String(doc.recurrenceParentId)
      : null,
    recurrenceExclusions: doc.recurrenceExclusions ?? [],
    location: doc.location ?? '',
    reminder: doc.reminder,
    linkedWorkOrderId: doc.linkedWorkOrderId
      ? String(doc.linkedWorkOrderId)
      : null,
    attachments: (doc.attachments ?? []).map((a) => String(a)),
    parentType: doc.parentType,
    parentId: String(doc.parentId),
    // BR-CC-8 — invitees field is fixed and not user-writable.
    invitees: 'All tenants',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
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

  const parsed = calendarEventUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // BR-CC-11 echo — End ≥ Start when both are explicit.
  const nextStart = parsed.data.startDate
    ? new Date(parsed.data.startDate)
    : doc.startDate;
  const nextEnd = parsed.data.endDate
    ? new Date(parsed.data.endDate)
    : doc.endDate;
  if (nextEnd && nextStart && nextEnd.getTime() < nextStart.getTime()) {
    return NextResponse.json(
      { error: 'endDate must be ≥ startDate (BR-CC-11)' },
      { status: 400 },
    );
  }

  const editScope = parsed.data.editScope ?? 'series';
  const isRecurring =
    doc.repeat !== 'Does not repeat' || !!doc.recurrenceParentId;

  if (isRecurring && editScope === 'instance' && !doc.recurrenceParentId) {
    // DECISIONS [G-B-13] — detach this occurrence from the master.
    // The new row carries the edits; the master records an exclusion.
    const clone = await CalendarEvent.create({
      organizationId: doc.organizationId,
      propertyId: doc.propertyId,
      parentType: 'CalendarEvent',
      parentId: doc._id,
      eventName: parsed.data.eventName ?? doc.eventName,
      title: parsed.data.eventName ?? doc.eventName,
      description: parsed.data.description ?? doc.description,
      startDate: nextStart,
      endDate: nextEnd,
      allDay: parsed.data.allDay ?? doc.allDay,
      timezone: doc.timezone,
      repeat: 'Does not repeat',
      recurrenceRule: '',
      recurrenceParentId: doc._id,
      location: parsed.data.location ?? doc.location,
      reminder: parsed.data.reminder ?? doc.reminder,
      linkedWorkOrderId: doc.linkedWorkOrderId,
      attachments: parsed.data.attachments
        ? parsed.data.attachments.map((id) => new Types.ObjectId(id))
        : doc.attachments,
      source: doc.source,
      createdByUserId: new Types.ObjectId(ctx.userId),
    });
    // Exclude the original occurrence on the master.
    await CalendarEvent.updateOne(
      { _id: doc._id },
      { $push: { recurrenceExclusions: doc.startDate } },
    );

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'CalendarEvent',
      parentId: doc._id,
      eventType: 'CalendarEvent instance detached',
      actorUserId: ctx.userId,
      payload: { newInstanceId: String(clone._id) },
    });

    return NextResponse.json({ ok: true, newInstanceId: String(clone._id) });
  }

  // `series` (or non-recurring) — mutate in place.
  if (parsed.data.eventName !== undefined) {
    doc.eventName = parsed.data.eventName;
    doc.title = parsed.data.eventName;
  }
  if (parsed.data.description !== undefined) {
    doc.description = parsed.data.description ?? undefined;
  }
  if (parsed.data.startDate !== undefined) doc.startDate = nextStart;
  if (parsed.data.endDate !== undefined) {
    doc.endDate = nextEnd ?? doc.endDate;
  }
  if (parsed.data.allDay !== undefined) doc.allDay = parsed.data.allDay;
  if (parsed.data.repeat !== undefined) {
    // Validator narrows enum members to `string`; cast back to the
    // canonical CalendarRepeat union the schema enforces at write time.
    doc.repeat = parsed.data.repeat as typeof doc.repeat;
  }
  if (parsed.data.recurrenceRule !== undefined) {
    doc.recurrenceRule = parsed.data.recurrenceRule;
  }
  if (parsed.data.location !== undefined) {
    doc.location = parsed.data.location ?? undefined;
  }
  if (parsed.data.reminder !== undefined) {
    doc.reminder = parsed.data.reminder as typeof doc.reminder;
    // New reminder configuration — reset dispatch marker so the sweep
    // can re-emit (BR-CC-8 audience may also have changed).
    doc.reminderSentAt = null;
  }
  if (parsed.data.attachments !== undefined) {
    doc.attachments = parsed.data.attachments.map(
      (id) => new Types.ObjectId(id),
    );
  }

  try {
    await doc.save();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'CalendarEvent',
    parentId: doc._id,
    eventType: 'CalendarEvent updated',
    actorUserId: ctx.userId,
    payload: { editScope },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const url = new URL(request.url);
  const parsed = calendarEventDeleteQuerySchema.safeParse({
    editScope: url.searchParams.get('editScope') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const editScope = parsed.data.editScope ?? 'series';
  const isRecurring =
    doc.repeat !== 'Does not repeat' || !!doc.recurrenceParentId;

  if (isRecurring && editScope === 'instance' && !doc.recurrenceParentId) {
    // Skip this occurrence only.
    await CalendarEvent.updateOne(
      { _id: doc._id },
      { $push: { recurrenceExclusions: doc.startDate } },
    );
    await logActivity({
      orgId: ctx.orgId,
      parentType: 'CalendarEvent',
      parentId: doc._id,
      eventType: 'CalendarEvent instance cancelled',
      actorUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  }

  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'CalendarEvent',
    parentId: doc._id,
    eventType: 'CalendarEvent deleted',
    actorUserId: ctx.userId,
    payload: { editScope },
  });

  return NextResponse.json({ ok: true });
}
