// OwnerContributionRequest CRUD (PDR §3.25, Phase 5 skeleton). Full A/P
// workflow + multi-step approve ships in Phase 9; this surface covers the
// Task cross-link so a PM can record the request from the Task detail.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { OwnerContributionRequest } from '@/lib/db/models/pm/OwnerContributionRequest';
import { RentalOwner } from '@/lib/db/models/pm/RentalOwner';
import { Task } from '@/lib/db/models/pm/Task';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { ownerContributionRequestCreateSchema } from '@/lib/validation/pm/ownerContributionRequest';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface OcrLeanLike {
  _id: unknown;
  status: string;
  dueDate: Date;
  propertiesScope: string;
  taskDescription: string;
  requestedFromOwnerId: unknown;
  priority: string;
  requestedAmount: number;
  receivedAmount: number;
  taskId?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const ownerId = searchParams.get('ownerId');
  const taskId = searchParams.get('taskId');

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (status) filter.status = status;
  if (ownerId && Types.ObjectId.isValid(ownerId)) {
    filter.requestedFromOwnerId = new Types.ObjectId(ownerId);
  }
  if (taskId && Types.ObjectId.isValid(taskId)) {
    filter.taskId = new Types.ObjectId(taskId);
  }

  const rows = await OwnerContributionRequest.find(filter)
    .sort({ createdAt: -1 })
    .lean<OcrLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      status: r.status,
      dueDate: r.dueDate,
      propertiesScope: r.propertiesScope,
      taskDescription: r.taskDescription,
      requestedFromOwnerId: String(r.requestedFromOwnerId),
      priority: r.priority,
      requestedAmount: r.requestedAmount,
      receivedAmount: r.receivedAmount,
      taskId: r.taskId ? String(r.taskId) : null,
      createdAt: r.createdAt,
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

  const parsed = ownerContributionRequestCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  // requestedFromOwnerId is now optional; when supplied, verify it belongs
  // to this org.
  if (parsed.data.requestedFromOwnerId) {
    const ownerCnt = await RentalOwner.countDocuments({
      _id: new Types.ObjectId(parsed.data.requestedFromOwnerId),
      organizationId: orgObjectId,
    });
    if (ownerCnt === 0) {
      return NextResponse.json(
        { error: 'requestedFromOwnerId does not reference an owner in this org' },
        { status: 400 },
      );
    }
  }

  if (parsed.data.taskId) {
    const taskCnt = await Task.countDocuments({
      _id: new Types.ObjectId(parsed.data.taskId),
      organizationId: orgObjectId,
    });
    if (taskCnt === 0) {
      return NextResponse.json(
        { error: 'taskId does not reference a task in this org' },
        { status: 400 },
      );
    }
  }

  const doc = await OwnerContributionRequest.create({
    organizationId: orgObjectId,
    status: parsed.data.status ?? 'New',
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    propertiesScope: parsed.data.propertiesScope ?? '',
    taskDescription: parsed.data.taskDescription ?? '',
    requestedFromOwnerId: parsed.data.requestedFromOwnerId
      ? new Types.ObjectId(parsed.data.requestedFromOwnerId)
      : null,
    priority: parsed.data.priority ?? 'Normal',
    requestedAmount: toCents(parsed.data.requestedAmount ?? 0),
    receivedAmount:
      typeof parsed.data.receivedAmount === 'number'
        ? toCents(parsed.data.receivedAmount)
        : 0,
    taskId: parsed.data.taskId ? new Types.ObjectId(parsed.data.taskId) : null,
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'OwnerContributionRequest',
    parentId: doc._id,
    eventType: 'OwnerContributionRequest created',
    actorUserId: ctx.userId,
    payload: {
      owner: doc.requestedFromOwnerId ? String(doc.requestedFromOwnerId) : null,
      requestedAmount: doc.requestedAmount,
    },
  });

  return NextResponse.json({ id: String(doc._id), warnings: doc.warnings ?? [] }, { status: 201 });
}
