// POST /api/pm/emails/[id]/cancel — revert a Scheduled email back to Draft.
// Pairs with the "Cancel" action on the Scheduled list row. The email
// stays in the system (so the user can re-schedule or send later); only
// the queue claim is released.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EmailMessage } from '@/lib/db/models/pm/EmailMessage';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface RouteContext {
  params: { id: string };
}

export async function POST(_request: Request, { params }: RouteContext) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  await connectToDatabase();

  const doc = await EmailMessage.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.status !== 'Scheduled') {
    return NextResponse.json(
      { error: `Only Scheduled emails can be cancelled (got ${doc.status})` },
      { status: 409 },
    );
  }
  doc.status = 'Draft';
  // Pre-save hook clears scheduledSendTime on Draft.
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EmailMessage',
    parentId: doc._id,
    eventType: 'Email schedule cancelled',
    actorUserId: ctx.userId,
    payload: { subject: doc.subject },
  });

  return NextResponse.json({ id: String(doc._id), status: doc.status });
}
