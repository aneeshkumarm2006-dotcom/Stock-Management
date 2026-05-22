// Per-row CRUD on RecurringTask (PDR §3.14, Phase 5). Edits are
// non-retroactive — `lastPostedDate` and `postedCount` cannot be patched.
// DELETE is soft: sets `active=false`.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RecurringTask } from '@/lib/db/models/pm/RecurringTask';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { recurringTaskUpdateSchema } from '@/lib/validation/pm/recurringTask';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return RecurringTask.findOne({
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
    title: doc.title,
    taskType: doc.taskType,
    cadence: doc.cadence,
    nextDate: doc.nextDate,
    priority: doc.priority,
    categoryId: doc.categoryId ? String(doc.categoryId) : null,
    propertyId: doc.propertyId ? String(doc.propertyId) : null,
    unitId: doc.unitId ? String(doc.unitId) : null,
    assignees: (doc.assignees ?? []).map((a) => String(a)),
    description: doc.description ?? '',
    duration: doc.duration,
    occurrenceCount: doc.occurrenceCount ?? null,
    active: doc.active,
    lastPostedDate: doc.lastPostedDate ?? null,
    postedCount: doc.postedCount,
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

  const parsed = recurringTaskUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const {
    categoryId,
    propertyId,
    unitId,
    assignees,
    nextDate,
    ...rest
  } = parsed.data;
  Object.assign(doc, rest);
  if (nextDate !== undefined) doc.nextDate = new Date(nextDate);
  if (categoryId !== undefined) {
    doc.categoryId = categoryId ? new Types.ObjectId(categoryId) : null;
  }
  if (propertyId !== undefined) {
    doc.propertyId = propertyId ? new Types.ObjectId(propertyId) : null;
  }
  if (unitId !== undefined) {
    doc.unitId = unitId ? new Types.ObjectId(unitId) : null;
  }
  if (assignees !== undefined) {
    doc.assignees = assignees.map((a) => new Types.ObjectId(a));
  }

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'RecurringTask',
    parentId: doc._id,
    eventType: 'RecurringTask updated',
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
    parentType: 'RecurringTask',
    parentId: doc._id,
    eventType: 'RecurringTask deactivated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
