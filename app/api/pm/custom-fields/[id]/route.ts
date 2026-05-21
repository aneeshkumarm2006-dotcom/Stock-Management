// Per-row CRUD on CustomFieldDefinition. PATCH updates label/order/required.
// DELETE soft-archives (sets active=false) so historical data with this key
// remains interpretable.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CustomFieldDefinition } from '@/lib/db/models/pm/CustomFieldDefinition';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { customFieldUpdateSchema } from '@/lib/validation/pm/customField';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function loadAndAuthorize(id: string, orgId: string) {
  await connectToDatabase();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await CustomFieldDefinition.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
  return doc;
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

  const parsed = customFieldUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await loadAndAuthorize(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  Object.assign(doc, parsed.data);
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Custom field updated',
    actorUserId: ctx.userId,
    payload: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const doc = await loadAndAuthorize(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  doc.active = false;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Custom field archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
