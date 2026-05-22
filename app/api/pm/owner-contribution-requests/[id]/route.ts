// Per-row CRUD on OwnerContributionRequest (PDR §3.25, Phase 5 skeleton).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { OwnerContributionRequest } from '@/lib/db/models/pm/OwnerContributionRequest';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { ownerContributionRequestUpdateSchema } from '@/lib/validation/pm/ownerContributionRequest';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return OwnerContributionRequest.findOne({
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
    status: doc.status,
    dueDate: doc.dueDate,
    propertiesScope: doc.propertiesScope,
    taskDescription: doc.taskDescription,
    requestedFromOwnerId: String(doc.requestedFromOwnerId),
    priority: doc.priority,
    requestedAmount: doc.requestedAmount,
    receivedAmount: doc.receivedAmount,
    taskId: doc.taskId ? String(doc.taskId) : null,
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

  const parsed = ownerContributionRequestUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (parsed.data.status !== undefined) doc.status = parsed.data.status;
  if (parsed.data.dueDate !== undefined) doc.dueDate = new Date(parsed.data.dueDate);
  if (parsed.data.propertiesScope !== undefined) {
    doc.propertiesScope = parsed.data.propertiesScope;
  }
  if (parsed.data.taskDescription !== undefined) {
    doc.taskDescription = parsed.data.taskDescription;
  }
  if (parsed.data.requestedFromOwnerId !== undefined) {
    doc.requestedFromOwnerId = new Types.ObjectId(parsed.data.requestedFromOwnerId);
  }
  if (parsed.data.priority !== undefined) doc.priority = parsed.data.priority;
  if (parsed.data.requestedAmount !== undefined) {
    doc.requestedAmount = toCents(parsed.data.requestedAmount);
  }
  if (parsed.data.receivedAmount !== undefined) {
    doc.receivedAmount = toCents(parsed.data.receivedAmount);
  }
  if (parsed.data.taskId !== undefined) {
    doc.taskId = parsed.data.taskId
      ? new Types.ObjectId(parsed.data.taskId)
      : null;
  }

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'OwnerContributionRequest',
    parentId: doc._id,
    eventType: 'OwnerContributionRequest updated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
