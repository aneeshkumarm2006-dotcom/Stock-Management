// Per-row Note ops. PATCH edits body/noteType (and stamps updatedByUserId);
// DELETE hard-removes (notes are not soft-archived — empty body would be
// awkward in the UI).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Note } from '@/lib/db/models/pm/Note';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { noteUpdateSchema } from '@/lib/validation/pm/note';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Note.findOne({
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

  const parsed = noteUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (parsed.data.body) doc.body = parsed.data.body;
  if (parsed.data.noteType) doc.noteType = parsed.data.noteType;
  doc.updatedByUserId = new Types.ObjectId(ctx.userId);
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: doc.parentType,
    parentId: doc.parentId,
    eventType: 'Note updated',
    actorUserId: ctx.userId,
    payload: { noteId: String(doc._id) },
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

  const { parentType, parentId, _id } = doc;
  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType,
    parentId,
    eventType: 'Note deleted',
    actorUserId: ctx.userId,
    payload: { noteId: String(_id) },
  });

  return NextResponse.json({ ok: true });
}
