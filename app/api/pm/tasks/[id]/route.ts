// Per-row CRUD on Task (PDR §3.13 skeleton). Status-roll-up validation per
// [G-B-33] runs here when status transitions to a terminal value.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Task } from '@/lib/db/models/pm/Task';
import { WorkOrder } from '@/lib/db/models/pm/WorkOrder';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { taskUpdateSchema } from '@/lib/validation/pm/task';
import { allWorkOrdersTerminal, isPastDue } from '@/lib/pm/taskHelpers';
import { logActivity } from '@/lib/pm/activity';
import type { TaskStatus, WorkOrderStatus } from '@/types/pm';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Task.findOne({
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
    taskId: doc.taskId,
    title: doc.title,
    taskType: doc.taskType,
    status: doc.status,
    priority: doc.priority,
    dueDate: doc.dueDate ?? null,
    pastDue: isPastDue(doc.dueDate ?? null, doc.status as TaskStatus),
    categoryId: doc.categoryId ? String(doc.categoryId) : null,
    propertyId: doc.propertyId ? String(doc.propertyId) : null,
    unitId: doc.unitId ? String(doc.unitId) : null,
    vendors: (doc.vendors ?? []).map((v) => String(v)),
    assignees: (doc.assignees ?? []).map((a) => String(a)),
    collaborators: (doc.collaborators ?? []).map((c) => String(c)),
    sourceTenantId: doc.sourceTenantId ? String(doc.sourceTenantId) : null,
    sourceOwnerId: doc.sourceOwnerId ? String(doc.sourceOwnerId) : null,
    sourceContactId: doc.sourceContactId ? String(doc.sourceContactId) : null,
    description: doc.description ?? '',
    workOrders: (doc.workOrders ?? []).map((w) => String(w)),
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

  const parsed = taskUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // [G-B-33] — Task → Completed requires every WO to be terminal.
  if (parsed.data.status === 'Completed' && doc.workOrders.length > 0) {
    const wos = await WorkOrder.find({
      _id: { $in: doc.workOrders },
      organizationId: new Types.ObjectId(ctx.orgId),
    })
      .select('status')
      .lean<Array<{ status: WorkOrderStatus }>>();
    const statuses = wos.map((w) => w.status);
    if (!allWorkOrdersTerminal(statuses)) {
      return NextResponse.json(
        {
          error:
            'Cannot complete task while one or more work orders remain open.',
        },
        { status: 409 },
      );
    }
  }

  const {
    dueDate,
    categoryId,
    propertyId,
    unitId,
    vendors,
    assignees,
    collaborators,
    sourceTenantId,
    sourceOwnerId,
    sourceContactId,
    ...rest
  } = parsed.data;
  Object.assign(doc, rest);
  if (dueDate !== undefined) {
    doc.dueDate = dueDate ? new Date(dueDate) : null;
  }
  if (categoryId !== undefined) {
    doc.categoryId = categoryId ? new Types.ObjectId(categoryId) : null;
  }
  if (propertyId !== undefined) {
    doc.propertyId = propertyId ? new Types.ObjectId(propertyId) : null;
  }
  if (unitId !== undefined) {
    doc.unitId = unitId ? new Types.ObjectId(unitId) : null;
  }
  if (vendors !== undefined) {
    doc.vendors = vendors.map((v) => new Types.ObjectId(v));
  }
  if (assignees !== undefined) {
    doc.assignees = assignees.map((a) => new Types.ObjectId(a));
  }
  if (collaborators !== undefined) {
    doc.collaborators = collaborators.map((c) => new Types.ObjectId(c));
  }
  if (sourceTenantId !== undefined) {
    doc.sourceTenantId = sourceTenantId
      ? new Types.ObjectId(sourceTenantId)
      : null;
  }
  if (sourceOwnerId !== undefined) {
    doc.sourceOwnerId = sourceOwnerId
      ? new Types.ObjectId(sourceOwnerId)
      : null;
  }
  if (sourceContactId !== undefined) {
    doc.sourceContactId = sourceContactId
      ? new Types.ObjectId(sourceContactId)
      : null;
  }

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Task updated',
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

  if (doc.workOrders.length > 0) {
    return NextResponse.json(
      {
        error:
          'Cannot delete a task that owns work orders. Cancel the work orders first.',
      },
      { status: 409 },
    );
  }

  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Task deleted',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
