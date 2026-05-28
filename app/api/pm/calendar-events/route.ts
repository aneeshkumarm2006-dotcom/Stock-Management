// CalendarEvent collection routes (Phase 7 — PDR_MASTER §3.34).
//
// GET  — list events in a date window, optionally overlaying up to 15
//        properties (BR-CC-7). Recurrence is expanded server-side so
//        the grid client doesn't need an RRULE parser.
// POST — create a single-property event (BR-CC-6). Timezone is snapshot
//        from the org (BR-CC-9); end defaults to start + 1h (BR-CC-11);
//        the row auto-publishes to Resident Center on save (BR-CC-10) —
//        no draft state to clear. Reminder fan-out happens in the
//        dispatcher sweep (lib/pm/calendarEvents.ts).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CalendarEvent } from '@/lib/db/models/pm/CalendarEvent';
import { Property } from '@/lib/db/models/pm/Property';
import { Organization } from '@/lib/db/models/pm/Organization';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  calendarEventCreateSchema,
  calendarEventListQuerySchema,
} from '@/lib/validation/pm/calendarEvent';
import { logActivity } from '@/lib/pm/activity';
import { expandRecurrence } from '@/lib/pm/calendarEvents';
import { CALENDAR_MAX_OVERLAYS } from '@/types/pm';
import { computeWarnings } from '@/lib/pm/warnings';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const url = new URL(request.url);
  const parsed = calendarEventListQuerySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    propertyIds: url.searchParams.get('propertyIds') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const now = new Date();
  const windowStart = parsed.data.from
    ? new Date(parsed.data.from)
    : new Date(now.getTime() - 7 * DAY_MS);
  const windowEnd = parsed.data.to
    ? new Date(parsed.data.to)
    : new Date(now.getTime() + 60 * DAY_MS);

  let propertyFilter: Types.ObjectId[] | null = null;
  if (parsed.data.propertyIds) {
    const ids = parsed.data.propertyIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => Types.ObjectId.isValid(s));
    if (ids.length > CALENDAR_MAX_OVERLAYS) {
      return NextResponse.json(
        {
          error: `Maximum ${CALENDAR_MAX_OVERLAYS} property overlays allowed (BR-CC-7)`,
        },
        { status: 400 },
      );
    }
    propertyFilter = ids.map((id) => new Types.ObjectId(id));
  }

  await connectToDatabase();
  const query: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
    // Pull masters whose window overlaps; recurrence expansion handles
    // the per-occurrence trimming below.
    $or: [
      { startDate: { $gte: windowStart, $lte: windowEnd } },
      { repeat: { $ne: 'Does not repeat' }, startDate: { $lte: windowEnd } },
    ],
  };
  if (propertyFilter) {
    query.propertyId = { $in: propertyFilter };
  }

  const docs = await CalendarEvent.find(query)
    .sort({ startDate: 1 })
    .lean();

  const rows = docs.flatMap((d) => {
    const occurrences = expandRecurrence(
      {
        _id: d._id,
        startDate: d.startDate,
        endDate: d.endDate,
        repeat: d.repeat,
        recurrenceExclusions: d.recurrenceExclusions ?? [],
      },
      windowStart,
      windowEnd,
    );
    return occurrences.map((occ) => ({
      id: String(d._id),
      occurrenceId: occ.occurrenceId,
      isMaster: occ.isMaster,
      propertyId: String(d.propertyId),
      eventName: d.eventName,
      description: d.description ?? '',
      startDate: occ.startDate,
      endDate: occ.endDate,
      allDay: d.allDay,
      timezone: d.timezone,
      repeat: d.repeat,
      location: d.location ?? '',
      reminder: d.reminder,
      linkedWorkOrderId: d.linkedWorkOrderId
        ? String(d.linkedWorkOrderId)
        : null,
      recurrenceParentId: d.recurrenceParentId
        ? String(d.recurrenceParentId)
        : null,
      attachments: (d.attachments ?? []).map((a) => String(a)),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
  });

  return NextResponse.json(rows);
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

  const parsed = calendarEventCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();

  // BR-CC-6 — confirm propertyId belongs to this org IF a propertyId is
  // supplied (it's now optional; absence becomes a CALENDAR_MISSING_PROPERTY
  // warning, not a 404).
  if (parsed.data.propertyId) {
    const property = await Property.findOne({
      _id: new Types.ObjectId(parsed.data.propertyId),
      organizationId: new Types.ObjectId(ctx.orgId),
    })
      .select('_id')
      .lean();
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found in this organization' },
        { status: 404 },
      );
    }
  }

  // BR-CC-9 — timezone is read-only and inherited from the org.
  const org = await Organization.findById(ctx.orgId).select('timezone').lean();
  const timezone = org?.timezone ?? 'America/New_York';

  let startDate: Date | null = null;
  if (parsed.data.startDate) {
    startDate = new Date(parsed.data.startDate);
    if (Number.isNaN(startDate.getTime())) {
      return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
    }
  }
  let endDate: Date | null = null;
  if (parsed.data.endDate) {
    endDate = new Date(parsed.data.endDate);
    if (Number.isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid endDate' }, { status: 400 });
    }
  }

  const source = parsed.data.source ?? 'Calendars';
  // Parent defaults to self (audit-log surface). The WorkOrder schedule
  // sub-route overrides this with parentType=WorkOrder + parentId=wo._id.
  const parentType = parsed.data.parentType ?? 'CalendarEvent';
  const parentId = parsed.data.parentId
    ? new Types.ObjectId(parsed.data.parentId)
    : null;

  let doc;
  try {
    doc = await CalendarEvent.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      propertyId: parsed.data.propertyId
        ? new Types.ObjectId(parsed.data.propertyId)
        : null,
      // parentId is required by the schema — when caller didn't provide
      // one we point it at the row's own id post-insert. To avoid a
      // second write, use an interim placeholder ObjectId and update.
      parentType,
      parentId: parentId ?? new Types.ObjectId(),
      eventName: parsed.data.eventName ?? '',
      title: parsed.data.eventName ?? '',
      description: parsed.data.description,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
      allDay: parsed.data.allDay ?? false,
      timezone,
      repeat: parsed.data.repeat ?? 'Does not repeat',
      recurrenceRule: parsed.data.recurrenceRule ?? '',
      location: parsed.data.location,
      reminder: parsed.data.reminder ?? 'None',
      linkedWorkOrderId: parsed.data.linkedWorkOrderId
        ? new Types.ObjectId(parsed.data.linkedWorkOrderId)
        : null,
      attachments: (parsed.data.attachments ?? []).map(
        (id) => new Types.ObjectId(id),
      ),
      source,
      createdByUserId: new Types.ObjectId(ctx.userId),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Self-reference the parent slot when caller didn't supply one (so the
  // activity-log Event history tab on the CalendarEvent detail renders).
  if (!parentId) {
    await CalendarEvent.updateOne(
      { _id: doc._id },
      { $set: { parentId: doc._id } },
    );
  }

  const computed = computeWarnings(doc.toObject(), 'CalendarEvent');
  if (computed.length > 0) {
    doc.warnings = computed;
    await doc.save();
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: parentType as never,
    parentId: parentId ?? doc._id,
    eventType: 'CalendarEvent published',
    actorUserId: ctx.userId,
    payload: {
      source,
      calendarEventId: String(doc._id),
      propertyId: parsed.data.propertyId,
      // BR-CC-10 — auto-publishes; recipient resolution is `All tenants`
      // on the Property at publish time (BR-CC-8).
      audience: 'All tenants',
    },
  });

  return NextResponse.json(
    {
      id: String(doc._id),
      propertyId: doc.propertyId ? String(doc.propertyId) : null,
      eventName: doc.eventName,
      timezone: doc.timezone,
      startDate: doc.startDate,
      endDate: doc.endDate,
      warnings: doc.warnings,
    },
    { status: 201 },
  );
}
