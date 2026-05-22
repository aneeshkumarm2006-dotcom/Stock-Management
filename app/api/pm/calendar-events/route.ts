// CalendarEvent POST stub (Phase 4 — BR-MV-7). The WorkOrder "Create work
// order and schedule event" action lands here. GET/PATCH/DELETE + the full
// grid surface ship with Phase 7 §3.34.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CalendarEvent } from '@/lib/db/models/pm/CalendarEvent';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { parentTypeSchema } from '@/lib/pm/parentTypes';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const calendarEventCreateSchema = z.object({
  parentType: parentTypeSchema,
  parentId: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id'),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  startDate: z.string().datetime().or(z.string().date()),
  endDate: z.string().datetime().or(z.string().date()).optional().nullable(),
  allDay: z.boolean().default(false),
  source: z.string().trim().min(1).max(60),
});

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

  const startDate = new Date(parsed.data.startDate);
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
  }
  const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  if (endDate && Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid endDate' }, { status: 400 });
  }

  await connectToDatabase();
  const doc = await CalendarEvent.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    parentType: parsed.data.parentType,
    parentId: new Types.ObjectId(parsed.data.parentId),
    title: parsed.data.title,
    description: parsed.data.description,
    startDate,
    endDate,
    allDay: parsed.data.allDay,
    source: parsed.data.source,
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'CalendarEvent',
    parentId: doc._id,
    eventType: 'CalendarEvent scheduled',
    actorUserId: ctx.userId,
    payload: {
      source: parsed.data.source,
      anchorParentType: parsed.data.parentType,
      anchorParentId: parsed.data.parentId,
    },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
