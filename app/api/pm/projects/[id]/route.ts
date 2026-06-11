// Per-row CRUD on Project (PDR §3.15, Phase 5). DELETE soft-archives via
// status='Closed' (BR-AC-18 soft-delete pattern). The Task ↔ Project
// linkage is symmetric — closing a Project leaves Task.projectIds[]
// untouched so historical context is preserved.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Project } from '@/lib/db/models/pm/Project';
import { Property } from '@/lib/db/models/pm/Property';
import { ProjectType } from '@/lib/db/models/pm/ProjectType';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { projectUpdateSchema } from '@/lib/validation/pm/project';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Project.findOne({
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
    projectTypeId: String(doc.projectTypeId),
    propertyId: String(doc.propertyId),
    projectLeadUserId: String(doc.projectLeadUserId),
    name: doc.name ?? '',
    description: doc.description ?? '',
    budget: doc.budget,
    dueDate: doc.dueDate ?? null,
    tasks: (doc.tasks ?? []).map((t) => String(t)),
    status: doc.status,
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

  const parsed = projectUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Fix 15 — a Closed project is read-only except for the reopen transition.
  // The only mutation allowed while Closed is `status` moving away from
  // 'Closed' (e.g. back to 'In progress'). Any field edit is rejected so the
  // server enforces what the detail page's `canEdit` flag implies client-side.
  if (doc.status === 'Closed') {
    const isReopen =
      parsed.data.status !== undefined && parsed.data.status !== 'Closed';
    const touchesOtherFields = Object.entries(parsed.data).some(
      ([key, value]) => key !== 'status' && value !== undefined,
    );
    if (!isReopen || touchesOtherFields) {
      return NextResponse.json(
        { error: 'Project is closed. Reopen it before editing.' },
        { status: 409 },
      );
    }
  }

  if (parsed.data.propertyId) {
    const cnt = await Property.countDocuments({
      _id: new Types.ObjectId(parsed.data.propertyId),
      organizationId: new Types.ObjectId(ctx.orgId),
    });
    if (cnt === 0) {
      return NextResponse.json(
        { error: 'propertyId does not reference a property in this org' },
        { status: 400 },
      );
    }
    doc.propertyId = new Types.ObjectId(parsed.data.propertyId);
  }
  if (parsed.data.projectTypeId) {
    const cnt = await ProjectType.countDocuments({
      _id: new Types.ObjectId(parsed.data.projectTypeId),
      organizationId: new Types.ObjectId(ctx.orgId),
    });
    if (cnt === 0) {
      return NextResponse.json(
        { error: 'projectTypeId does not reference a project type in this org' },
        { status: 400 },
      );
    }
    doc.projectTypeId = new Types.ObjectId(parsed.data.projectTypeId);
  }
  if (parsed.data.projectLeadUserId) {
    doc.projectLeadUserId = new Types.ObjectId(parsed.data.projectLeadUserId);
  }
  if (parsed.data.name !== undefined) doc.name = parsed.data.name;
  if (parsed.data.description !== undefined) {
    doc.description = parsed.data.description;
  }
  if (parsed.data.budget !== undefined) {
    doc.budget = toCents(parsed.data.budget);
  }
  if (parsed.data.dueDate !== undefined) {
    doc.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }
  if (parsed.data.status !== undefined) doc.status = parsed.data.status;

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Project',
    parentId: doc._id,
    eventType: 'Project updated',
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

  doc.status = 'Closed';
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Project',
    parentId: doc._id,
    eventType: 'Project closed',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
