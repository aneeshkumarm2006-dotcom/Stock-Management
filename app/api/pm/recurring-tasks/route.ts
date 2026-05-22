// RecurringTask CRUD (PDR §3.14, Phase 5). Cadence engine lives in
// lib/pm/recurringTaskPoster.ts; edits are non-retroactive — the route
// rejects mutations on `lastPostedDate` and `postedCount`.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RecurringTask } from '@/lib/db/models/pm/RecurringTask';
import { Property } from '@/lib/db/models/pm/Property';
import { Unit } from '@/lib/db/models/pm/Unit';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { recurringTaskCreateSchema } from '@/lib/validation/pm/recurringTask';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface RtLeanLike {
  _id: unknown;
  title: string;
  taskType: string;
  cadence: string;
  nextDate: Date;
  priority: string;
  duration: string;
  occurrenceCount?: number | null;
  active: boolean;
  postedCount: number;
  lastPostedDate?: Date | null;
  propertyId?: unknown;
  unitId?: unknown;
}

async function ensurePropertyInOrg(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return false;
  const cnt = await Property.countDocuments({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt > 0;
}

async function ensureUnitInOrg(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return false;
  const cnt = await Unit.countDocuments({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt > 0;
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

  const rows = await RecurringTask.find(filter)
    .sort({ nextDate: 1 })
    .lean<RtLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      title: r.title,
      taskType: r.taskType,
      cadence: r.cadence,
      nextDate: r.nextDate,
      priority: r.priority,
      duration: r.duration,
      occurrenceCount: r.occurrenceCount ?? null,
      remainingOccurrences:
        typeof r.occurrenceCount === 'number'
          ? Math.max(0, r.occurrenceCount - r.postedCount)
          : null,
      active: r.active,
      postedCount: r.postedCount,
      lastPostedDate: r.lastPostedDate ?? null,
      propertyId: r.propertyId ? String(r.propertyId) : null,
      unitId: r.unitId ? String(r.unitId) : null,
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

  const parsed = recurringTaskCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  if (
    parsed.data.propertyId &&
    !(await ensurePropertyInOrg(parsed.data.propertyId, ctx.orgId))
  ) {
    return NextResponse.json(
      { error: 'propertyId does not reference a property in this org' },
      { status: 400 },
    );
  }
  if (
    parsed.data.unitId &&
    !(await ensureUnitInOrg(parsed.data.unitId, ctx.orgId))
  ) {
    return NextResponse.json(
      { error: 'unitId does not reference a unit in this org' },
      { status: 400 },
    );
  }

  const nextDate = new Date(parsed.data.nextDate);
  if (Number.isNaN(nextDate.getTime())) {
    return NextResponse.json({ error: 'Invalid nextDate' }, { status: 400 });
  }

  const doc = await RecurringTask.create({
    organizationId: orgObjectId,
    title: parsed.data.title,
    taskType: parsed.data.taskType ?? 'To do',
    cadence: parsed.data.cadence,
    nextDate,
    priority: parsed.data.priority ?? 'Normal',
    categoryId: parsed.data.categoryId
      ? new Types.ObjectId(parsed.data.categoryId)
      : null,
    propertyId: parsed.data.propertyId
      ? new Types.ObjectId(parsed.data.propertyId)
      : null,
    unitId: parsed.data.unitId
      ? new Types.ObjectId(parsed.data.unitId)
      : null,
    assignees: (parsed.data.assignees ?? []).map((a) => new Types.ObjectId(a)),
    description: parsed.data.description,
    duration: parsed.data.duration ?? 'Until cancelled',
    occurrenceCount: parsed.data.occurrenceCount ?? null,
    active: parsed.data.active ?? true,
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'RecurringTask',
    parentId: doc._id,
    eventType: 'RecurringTask created',
    actorUserId: ctx.userId,
    payload: { title: doc.title, cadence: doc.cadence },
  });

  return NextResponse.json(
    { id: String(doc._id) },
    { status: 201 },
  );
}
