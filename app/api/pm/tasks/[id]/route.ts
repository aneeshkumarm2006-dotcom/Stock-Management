// Per-row CRUD on Task (PDR §3.13 skeleton). Status-roll-up validation per
// [G-B-33] runs here when status transitions to a terminal value.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Task, TASK_TERMINAL_STATUSES_DB } from '@/lib/db/models/pm/Task';
import { Project } from '@/lib/db/models/pm/Project';
import { WorkOrder } from '@/lib/db/models/pm/WorkOrder';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { taskUpdateSchema } from '@/lib/validation/pm/task';
import { allWorkOrdersTerminal, isPastDue } from '@/lib/pm/taskHelpers';
import { logActivity } from '@/lib/pm/activity';
import {
  notifyTaskAssigned,
  notifyTaskCompleted,
} from '@/lib/pm/taskNotifications';
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
    projectIds: (doc.projectIds ?? []).map((p) => String(p)),
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
    projectIds,
    ...rest
  } = parsed.data;
  const previousAssignees = (doc.assignees ?? []).map((a) => String(a));
  const previousStatus = doc.status;
  const previousProjectIds = (doc.projectIds ?? []).map((p) => String(p));
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
  if (projectIds !== undefined) {
    doc.projectIds = projectIds.map((p) => new Types.ObjectId(p));
  }

  await doc.save();

  // Sync the symmetric Project.tasks[] (Phase 5 [G-B-31]).
  if (projectIds !== undefined) {
    const next = new Set(projectIds);
    const previous = new Set(previousProjectIds);
    const added = Array.from(next).filter((p) => !previous.has(p));
    const removed = Array.from(previous).filter((p) => !next.has(p));
    if (added.length > 0) {
      await Project.updateMany(
        {
          _id: { $in: added.map((p) => new Types.ObjectId(p)) },
          organizationId: new Types.ObjectId(ctx.orgId),
        },
        { $addToSet: { tasks: doc._id } },
      );
    }
    if (removed.length > 0) {
      await Project.updateMany(
        {
          _id: { $in: removed.map((p) => new Types.ObjectId(p)) },
          organizationId: new Types.ObjectId(ctx.orgId),
        },
        { $pull: { tasks: doc._id } },
      );
    }
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Task updated',
    actorUserId: ctx.userId,
  });

  // [G-S-40] — assignment notification fan-out for any newly added assignees.
  if (assignees !== undefined) {
    const prev = new Set(previousAssignees);
    const newlyAdded = assignees.filter((a) => !prev.has(a));
    if (newlyAdded.length > 0) {
      await notifyTaskAssigned(
        {
          _id: doc._id,
          organizationId: doc.organizationId,
          taskId: doc.taskId,
          title: doc.title,
        },
        newlyAdded,
      );
    }
  }
  // [G-S-40] — terminal-transition notification.
  if (
    doc.status !== previousStatus &&
    (TASK_TERMINAL_STATUSES_DB as readonly string[]).includes(doc.status)
  ) {
    await notifyTaskCompleted(doc);
  }

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

  // Detach from any Projects before delete (Phase 5 [G-B-31]).
  if (doc.projectIds && doc.projectIds.length > 0) {
    await Project.updateMany(
      {
        _id: { $in: doc.projectIds },
        organizationId: new Types.ObjectId(ctx.orgId),
      },
      { $pull: { tasks: doc._id } },
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
