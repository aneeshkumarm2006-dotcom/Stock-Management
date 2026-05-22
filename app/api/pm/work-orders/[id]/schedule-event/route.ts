// WorkOrder → CalendarEvent schedule action (BR-MV-7). Phase 4 writes the
// minimal stub event; Phase 7 fills the full grid + reminders surface.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { WorkOrder } from '@/lib/db/models/pm/WorkOrder';
import { CalendarEvent } from '@/lib/db/models/pm/CalendarEvent';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const scheduleSchema = z.object({
  startDate: z.string().datetime().or(z.string().date()),
  endDate: z.string().datetime().or(z.string().date()).optional(),
  allDay: z.boolean().optional().default(false),
  title: z.string().min(1).max(200).optional(),
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

  const startDate = new Date(parsed.data.startDate);
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
  }
  const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  if (endDate && Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid endDate' }, { status: 400 });
  }

  const event = await CalendarEvent.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    parentType: 'WorkOrder',
    parentId: wo._id,
    title: parsed.data.title ?? `WO: ${wo.subject}`,
    description: wo.workToBePerformed,
    startDate,
    endDate,
    allDay: parsed.data.allDay ?? false,
    source: 'WorkOrder',
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'WorkOrder',
    parentId: wo._id,
    eventType: 'Calendar event scheduled',
    actorUserId: ctx.userId,
    payload: { calendarEventId: String(event._id), startDate: parsed.data.startDate },
  });

  return NextResponse.json(
    { id: String(event._id), workOrderId: String(wo._id) },
    { status: 201 },
  );
}
