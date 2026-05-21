// POST /api/pm/properties/[id]/reactivate — restore a soft-archived property
// (DECISIONS.md [G-B-2]). Restricted to Admin or PropertyManager.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Property } from '@/lib/db/models/pm/Property';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const canReactivate =
    ctx.roles.includes('Admin') || ctx.roles.includes('PropertyManager');
  if (!canReactivate) {
    return NextResponse.json(
      { error: 'Only Admin or PropertyManager can reactivate properties' },
      { status: 403 },
    );
  }

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
  }

  await connectToDatabase();
  const doc = await Property.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.active) {
    return NextResponse.json({ ok: true, alreadyActive: true });
  }

  doc.active = true;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Property',
    parentId: doc._id,
    eventType: 'Property reactivated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
