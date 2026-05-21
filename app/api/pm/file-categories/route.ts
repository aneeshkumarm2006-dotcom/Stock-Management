// FileCategory CRUD. Org-scoped. System-seeded `Leases` is undeletable
// (handled in [id]/route.ts).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { FileCategory } from '@/lib/db/models/pm/FileCategory';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { fileCategoryCreateSchema } from '@/lib/validation/pm/fileCategory';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: d.name,
    systemSeeded: d.systemSeeded,
    inUseCount: d.inUseCount,
    active: d.active,
  };
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const rows = await FileCategory.find({
    organizationId: new Types.ObjectId(ctx.orgId),
  })
    .sort({ systemSeeded: -1, name: 1 })
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

  const parsed = fileCategoryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  try {
    const doc = await FileCategory.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      name: parsed.data.name,
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Task',
      parentId: doc._id,
      eventType: 'File category created',
      actorUserId: ctx.userId,
      payload: { name: doc.name },
    });

    return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), { status: 201 });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 },
      );
    }
    throw err;
  }
}
