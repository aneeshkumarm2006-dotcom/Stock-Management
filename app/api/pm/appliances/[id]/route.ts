// Per-row CRUD on Appliance.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Appliance } from '@/lib/db/models/pm/Appliance';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { applianceUpdateSchema } from '@/lib/validation/pm/appliance';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Appliance.findOne({
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

  const parsed = applianceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { installedDate, ...rest } = parsed.data;
  Object.assign(doc, rest);
  if (installedDate !== undefined) {
    doc.installedDate = installedDate ? new Date(installedDate) : null;
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Unit',
    parentId: doc.unitId,
    eventType: 'Appliance updated',
    actorUserId: ctx.userId,
    payload: { applianceId: String(doc._id) },
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
  const unitId = doc.unitId;
  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Unit',
    parentId: unitId,
    eventType: 'Appliance removed',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
