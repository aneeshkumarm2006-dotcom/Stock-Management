// POST /api/pm/draft-leases/:id/cancel
//
// Sets executionStatus to Cancelled. [G-B-1] reversibility: a Cancelled
// draft can be flipped back to Draft via the main PATCH route IFF
// `promotedToLeaseId` is null. The route doesn't refuse the cancel on an
// already-promoted lease, but does refuse if the draft is already Executed
// (the lease exists; cancelling now would orphan it).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { DraftLease } from '@/lib/db/models/pm/DraftLease';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { draftLeaseCancelSchema } from '@/lib/validation/pm/draftLease';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body OK
  }
  const parsed = draftLeaseCancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await DraftLease.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.executionStatus === 'Executed') {
    return NextResponse.json(
      { error: 'Executed draft leases cannot be cancelled.' },
      { status: 409 },
    );
  }
  if (doc.executionStatus === 'Cancelled') {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  doc.executionStatus = 'Cancelled';
  doc.cancelledAt = new Date();
  doc.cancelledByUserId = new Types.ObjectId(ctx.userId);
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'DraftLease',
    parentId: doc._id,
    eventType: 'Draft lease cancelled',
    actorUserId: ctx.userId,
    payload: parsed.data.reason ? { reason: parsed.data.reason } : undefined,
  });

  return NextResponse.json({ ok: true });
}
