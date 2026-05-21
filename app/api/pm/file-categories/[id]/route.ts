// Per-row CRUD on FileCategory. Delete is blocked when `inUseCount > 0`
// (BR-FI-6) and when `systemSeeded === true` (the `Leases` default cannot be
// removed).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { FileCategory } from '@/lib/db/models/pm/FileCategory';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { fileCategoryUpdateSchema } from '@/lib/validation/pm/fileCategory';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return FileCategory.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
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

  const parsed = fileCategoryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.systemSeeded && parsed.data.name) {
    return NextResponse.json(
      { error: 'System-seeded categories cannot be renamed' },
      { status: 400 },
    );
  }

  Object.assign(doc, parsed.data);
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'File category updated',
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

  if (doc.systemSeeded) {
    return NextResponse.json(
      { error: 'System-seeded categories cannot be deleted' },
      { status: 400 },
    );
  }
  if (doc.inUseCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete: ${doc.inUseCount} files use this category. Reassign first.`,
      },
      { status: 409 },
    );
  }

  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'File category deleted',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
