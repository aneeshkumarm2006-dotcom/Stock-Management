// Per-row LockedPeriodPolicy ops. PATCH lets admins toggle active or tweak
// dates/message. DELETE soft-archives (active=false) so historical override
// audits can still resolve a policyId.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { LockedPeriodPolicy } from '@/lib/db/models/pm/LockedPeriodPolicy';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { lockedPeriodUpdateSchema } from '@/lib/validation/pm/lockedPeriodPolicy';
import { logActivity } from '@/lib/pm/activity';
import { canManageOrg } from '@/lib/pm/roles';
import { serializeLockedPeriod } from '../route';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return LockedPeriodPolicy.findOne({
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
  return NextResponse.json(
    serializeLockedPeriod(doc.toObject() as unknown as Record<string, unknown>),
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!canManageOrg(ctx)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = lockedPeriodUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (parsed.data.scope !== undefined) doc.scope = parsed.data.scope;
  if (parsed.data.propertyId !== undefined) {
    doc.propertyId = parsed.data.propertyId
      ? new Types.ObjectId(parsed.data.propertyId)
      : null;
  }
  if (parsed.data.fromDate !== undefined) {
    doc.fromDate = parsed.data.fromDate ? new Date(parsed.data.fromDate) : null;
  }
  if (parsed.data.toDate !== undefined) {
    doc.toDate = parsed.data.toDate ? new Date(parsed.data.toDate) : null;
  }
  if (parsed.data.message !== undefined) doc.message = parsed.data.message;
  if (parsed.data.active !== undefined) doc.active = parsed.data.active;

  try {
    await doc.save();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update locked period policy';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'LockedPeriodPolicy',
    parentId: doc._id,
    eventType: 'Locked period policy updated',
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
  if (!canManageOrg(ctx)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  doc.active = false;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'LockedPeriodPolicy',
    parentId: doc._id,
    eventType: 'Locked period policy archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
