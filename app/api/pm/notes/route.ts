// Polymorphic Note ingestion (PDR_MASTER §3.33). Lists by parent (?parentType
// + ?parentId); POST creates against any PARENT_TYPES value.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Note } from '@/lib/db/models/pm/Note';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { noteCreateSchema } from '@/lib/validation/pm/note';
import { logActivity } from '@/lib/pm/activity';
import { isParentType } from '@/lib/pm/parentTypes';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    parentType: d.parentType,
    parentId: String(d.parentId),
    body: d.body,
    noteType: d.noteType,
    updatedByUserId: String(d.updatedByUserId),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const parentType = searchParams.get('parentType');
  const parentId = searchParams.get('parentId');
  if (!parentType || !parentId || !isParentType(parentType)) {
    return NextResponse.json(
      { error: 'parentType + parentId required' },
      { status: 400 },
    );
  }
  if (!Types.ObjectId.isValid(parentId)) {
    return NextResponse.json({ error: 'Invalid parentId' }, { status: 400 });
  }

  await connectToDatabase();
  const rows = await Note.find({
    organizationId: new Types.ObjectId(ctx.orgId),
    parentType,
    parentId: new Types.ObjectId(parentId),
  })
    .sort({ createdAt: -1 })
    .limit(200)
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

  const parsed = noteCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await Note.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    parentType: parsed.data.parentType,
    parentId: new Types.ObjectId(parsed.data.parentId),
    body: parsed.data.body,
    noteType: parsed.data.noteType ?? 'RENTAL',
    updatedByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: parsed.data.parentType,
    parentId: parsed.data.parentId,
    eventType: 'Note created',
    actorUserId: ctx.userId,
    payload: { noteId: String(doc._id) },
  });

  return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), { status: 201 });
}
