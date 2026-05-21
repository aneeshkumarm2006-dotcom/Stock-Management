// ProjectType CRUD. Flat per-org list (Phase 5+ Project §3.15 references).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ProjectType } from '@/lib/db/models/pm/ProjectType';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { projectTypeCreateSchema } from '@/lib/validation/pm/projectType';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: d.name,
    color: d.color ?? null,
    systemSeeded: d.systemSeeded,
    active: d.active,
  };
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const rows = await ProjectType.find({
    organizationId: new Types.ObjectId(ctx.orgId),
    active: true,
  })
    .sort({ name: 1 })
    .lean();

  return NextResponse.json(rows.map(serialize));
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

  const parsed = projectTypeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  try {
    const doc = await ProjectType.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      ...parsed.data,
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Task',
      parentId: doc._id,
      eventType: 'Project type created',
      actorUserId: ctx.userId,
    });

    return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), { status: 201 });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: 'A project type with this name already exists' },
        { status: 409 },
      );
    }
    throw err;
  }
}
