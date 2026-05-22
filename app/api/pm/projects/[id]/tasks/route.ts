// Project ↔ Task M:N linkage (Phase 5 [G-B-31]). POST attaches Tasks; DELETE
// detaches. Both sides (Project.tasks[] + Task.projectIds[]) update atomically.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Project } from '@/lib/db/models/pm/Project';
import { Task } from '@/lib/db/models/pm/Task';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  projectAddTasksSchema,
  projectRemoveTasksSchema,
} from '@/lib/validation/pm/project';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function loadProject(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Project.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

async function ensureTasksInOrg(ids: string[], orgId: string) {
  if (ids.length === 0) return true;
  const objectIds = ids.map((i) => new Types.ObjectId(i));
  const cnt = await Task.countDocuments({
    _id: { $in: objectIds },
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt === ids.length;
}

export async function POST(
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

  const parsed = projectAddTasksSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const project = await loadProject(params.id, ctx.orgId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (!(await ensureTasksInOrg(parsed.data.taskIds, ctx.orgId))) {
    return NextResponse.json(
      { error: 'One or more task ids are invalid for this org' },
      { status: 400 },
    );
  }

  const taskObjectIds = parsed.data.taskIds.map((t) => new Types.ObjectId(t));

  // Both sides at once. $addToSet keeps the link idempotent.
  await Promise.all([
    Project.updateOne(
      { _id: project._id },
      { $addToSet: { tasks: { $each: taskObjectIds } } },
    ),
    Task.updateMany(
      {
        _id: { $in: taskObjectIds },
        organizationId: new Types.ObjectId(ctx.orgId),
      },
      { $addToSet: { projectIds: project._id } },
    ),
  ]);

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Project',
    parentId: project._id,
    eventType: 'Tasks attached to project',
    actorUserId: ctx.userId,
    payload: { taskIds: parsed.data.taskIds },
  });

  return NextResponse.json({ ok: true, attached: parsed.data.taskIds.length });
}

export async function DELETE(
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

  const parsed = projectRemoveTasksSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const project = await loadProject(params.id, ctx.orgId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const taskObjectIds = parsed.data.taskIds.map((t) => new Types.ObjectId(t));

  await Promise.all([
    Project.updateOne(
      { _id: project._id },
      { $pull: { tasks: { $in: taskObjectIds } } },
    ),
    Task.updateMany(
      {
        _id: { $in: taskObjectIds },
        organizationId: new Types.ObjectId(ctx.orgId),
      },
      { $pull: { projectIds: project._id } },
    ),
  ]);

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Project',
    parentId: project._id,
    eventType: 'Tasks detached from project',
    actorUserId: ctx.userId,
    payload: { taskIds: parsed.data.taskIds },
  });

  return NextResponse.json({ ok: true, detached: parsed.data.taskIds.length });
}
