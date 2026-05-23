// WorkOrder → CalendarEvent schedule action (BR-MV-7).
//
// Phase 7 fills the full CalendarEvent surface: the resulting row carries
// the WO's propertyId (BR-CC-6 single-property scope), org timezone
// (BR-CC-9), and a `linkedWorkOrderId` back-pointer. End defaults to
// start + 1h (BR-CC-11). Reminder is opt-in via the request body — the
// AddWorkOrderModal currently passes none, but a future surface (WO
// detail page) can set it.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { WorkOrder } from '@/lib/db/models/pm/WorkOrder';
import { CalendarEvent } from '@/lib/db/models/pm/CalendarEvent';
import { Organization } from '@/lib/db/models/pm/Organization';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';
import { CALENDAR_REMINDERS } from '@/types/pm';

export const runtime = 'nodejs';

const scheduleSchema = z.object({
  startDate: z.string().datetime().or(z.string().date()),
  endDate: z.string().datetime().or(z.string().date()).optional(),
  allDay: z.boolean().optional().default(false),
  title: z.string().min(1).max(200).optional(),
  reminder: z
    .enum(CALENDAR_REMINDERS as readonly [string, ...string[]])
    .optional()
    .default('None'),
  location: z.string().trim().max(200).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const wo = await WorkOrder.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
  if (!wo) {
    return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
  }
  if (!wo.propertyId) {
    // BR-CC-6 — CalendarEvent requires a propertyId. WorkOrders without
    // one cannot publish to Resident Center.
    return NextResponse.json(
      {
        error:
          'Work order has no Property — assign one before scheduling an event (BR-CC-6)',
      },
      { status: 400 },
    );
  }

  const startDate = new Date(parsed.data.startDate);
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
  }
  const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  if (endDate && Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid endDate' }, { status: 400 });
  }

  const org = await Organization.findById(ctx.orgId).select('timezone').lean();
  const timezone = org?.timezone ?? 'America/New_York';

  const eventName = parsed.data.title ?? `WO: ${wo.subject}`;
  const event = await CalendarEvent.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    propertyId: wo.propertyId,
    parentType: 'WorkOrder',
    parentId: wo._id,
    eventName,
    title: eventName,
    description: wo.workToBePerformed,
    startDate,
    endDate: endDate ?? undefined,
    allDay: parsed.data.allDay ?? false,
    timezone,
    repeat: 'Does not repeat',
    reminder: parsed.data.reminder ?? 'None',
    location: parsed.data.location,
    linkedWorkOrderId: wo._id,
    source: 'WorkOrder',
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'WorkOrder',
    parentId: wo._id,
    eventType: 'Calendar event scheduled',
    actorUserId: ctx.userId,
    payload: {
      calendarEventId: String(event._id),
      startDate: parsed.data.startDate,
      reminder: event.reminder,
    },
  });

  return NextResponse.json(
    { id: String(event._id), workOrderId: String(wo._id) },
    { status: 201 },
  );
}
