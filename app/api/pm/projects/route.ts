// Project CRUD (PDR §3.15, Phase 5). BR-TP-8 — Tasks can only be added
// after creation, so POST refuses a `tasks[]` body (the create schema is
// `.strict()`). Use POST /api/pm/projects/[id]/tasks to attach Tasks.
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
import { projectCreateSchema } from '@/lib/validation/pm/project';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface ProjectLeanLike {
  _id: unknown;
  projectTypeId: unknown;
  propertyId: unknown;
  projectLeadUserId: unknown;
  name?: string;
  description?: string;
  budget: number;
  dueDate?: Date | null;
  tasks?: unknown[];
  status: string;
  createdAt: Date;
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

async function ensureProjectTypeInOrg(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return false;
  const cnt = await ProjectType.countDocuments({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt > 0;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const propertyId = searchParams.get('propertyId');
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (status === 'in-progress') filter.status = 'In progress';
  else if (status === 'closed') filter.status = 'Closed';

  if (propertyId && Types.ObjectId.isValid(propertyId)) {
    filter.propertyId = new Types.ObjectId(propertyId);
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.name = rx;
  }

  const rows = await Project.find(filter)
    .sort({ createdAt: -1 })
    .lean<ProjectLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      projectTypeId: String(r.projectTypeId),
      propertyId: String(r.propertyId),
      projectLeadUserId: String(r.projectLeadUserId),
      name: r.name ?? '',
      description: r.description ?? '',
      budget: r.budget,
      dueDate: r.dueDate ?? null,
      taskCount: (r.tasks ?? []).length,
      status: r.status,
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

  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) {
    // BR-TP-8 — `.strict()` rejects unrecognised keys (including `tasks`).
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();

  if (!(await ensurePropertyInOrg(parsed.data.propertyId, ctx.orgId))) {
    return NextResponse.json(
      { error: 'propertyId does not reference a property in this org' },
      { status: 400 },
    );
  }
  if (!(await ensureProjectTypeInOrg(parsed.data.projectTypeId, ctx.orgId))) {
    return NextResponse.json(
      { error: 'projectTypeId does not reference a project type in this org' },
      { status: 400 },
    );
  }

  const doc = await Project.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    projectTypeId: new Types.ObjectId(parsed.data.projectTypeId),
    propertyId: new Types.ObjectId(parsed.data.propertyId),
    projectLeadUserId: new Types.ObjectId(parsed.data.projectLeadUserId),
    name: parsed.data.name,
    description: parsed.data.description,
    budget:
      typeof parsed.data.budget === 'number' ? toCents(parsed.data.budget) : 0,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    status: 'In progress',
    tasks: [],
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Project',
    parentId: doc._id,
    eventType: 'Project created',
    actorUserId: ctx.userId,
    payload: { name: doc.name, propertyId: String(doc.propertyId) },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
