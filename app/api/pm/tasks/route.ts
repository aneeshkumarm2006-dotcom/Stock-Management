// Task CRUD (PDR §3.13). Phase 4 ships the skeleton so WorkOrder has a
// parent (BR-MV-5); full UI lands Phase 5.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Task } from '@/lib/db/models/pm/Task';
import { Property } from '@/lib/db/models/pm/Property';
import { Unit } from '@/lib/db/models/pm/Unit';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { taskCreateSchema } from '@/lib/validation/pm/task';
import { nextTaskId } from '@/lib/pm/taskIdSequence';
import { isPastDue } from '@/lib/pm/taskHelpers';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface TaskLeanLike {
  _id: unknown;
  taskId: number;
  title: string;
  taskType: string;
  status: string;
  priority: string;
  dueDate?: Date | null;
  propertyId?: unknown;
  unitId?: unknown;
  vendors?: unknown[];
  workOrders?: unknown[];
  updatedAt: Date;
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

async function ensureVendorsInOrg(ids: string[], orgId: string) {
  if (ids.length === 0) return true;
  const objectIds = ids.map((i) => new Types.ObjectId(i));
  const cnt = await Vendor.countDocuments({
    _id: { $in: objectIds },
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt === ids.length;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get('propertyId');
  const status = searchParams.get('status');
  const taskType = searchParams.get('taskType');
  const includeTerminal = searchParams.get('includeTerminal') === '1';
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeTerminal) {
    filter.status = { $nin: ['Completed', 'Closed', 'Cancelled'] };
  } else if (status) {
    filter.status = status;
  }
  if (taskType) filter.taskType = taskType;
  if (propertyId && Types.ObjectId.isValid(propertyId)) {
    filter.propertyId = new Types.ObjectId(propertyId);
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.title = rx;
  }

  const rows = await Task.find(filter)
    .sort({ taskId: -1 })
    .lean<TaskLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      taskId: r.taskId,
      title: r.title,
      taskType: r.taskType,
      status: r.status,
      priority: r.priority,
      dueDate: r.dueDate ?? null,
      pastDue: isPastDue(
        r.dueDate ?? null,
        r.status as Parameters<typeof isPastDue>[1],
      ),
      propertyId: r.propertyId ? String(r.propertyId) : null,
      unitId: r.unitId ? String(r.unitId) : null,
      vendorIds: (r.vendors ?? []).map((v) => String(v)),
      workOrderIds: (r.workOrders ?? []).map((w) => String(w)),
      updatedAt: r.updatedAt,
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

  const parsed = taskCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();

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
  if (
    parsed.data.vendors &&
    !(await ensureVendorsInOrg(parsed.data.vendors, ctx.orgId))
  ) {
    return NextResponse.json(
      { error: 'One or more vendor ids are invalid for this org' },
      { status: 400 },
    );
  }

  const taskId = await nextTaskId(ctx.orgId);

  const doc = await Task.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    taskId,
    title: parsed.data.title,
    taskType: parsed.data.taskType ?? 'To do',
    status: parsed.data.status ?? 'New',
    priority: parsed.data.priority ?? 'Normal',
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    categoryId: parsed.data.categoryId
      ? new Types.ObjectId(parsed.data.categoryId)
      : null,
    propertyId: parsed.data.propertyId
      ? new Types.ObjectId(parsed.data.propertyId)
      : null,
    unitId: parsed.data.unitId ? new Types.ObjectId(parsed.data.unitId) : null,
    vendors: (parsed.data.vendors ?? []).map((v) => new Types.ObjectId(v)),
    assignees: (parsed.data.assignees ?? []).map((a) => new Types.ObjectId(a)),
    collaborators: (parsed.data.collaborators ?? []).map(
      (c) => new Types.ObjectId(c),
    ),
    sourceTenantId: parsed.data.sourceTenantId
      ? new Types.ObjectId(parsed.data.sourceTenantId)
      : null,
    sourceOwnerId: parsed.data.sourceOwnerId
      ? new Types.ObjectId(parsed.data.sourceOwnerId)
      : null,
    sourceContactId: parsed.data.sourceContactId
      ? new Types.ObjectId(parsed.data.sourceContactId)
      : null,
    description: parsed.data.description,
    workOrders: [],
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Task created',
    actorUserId: ctx.userId,
    payload: { taskId, title: doc.title, taskType: doc.taskType },
  });

  return NextResponse.json(
    { id: String(doc._id), taskId: doc.taskId },
    { status: 201 },
  );
}
