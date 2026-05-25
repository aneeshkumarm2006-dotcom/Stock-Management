// POST /api/pm/emails/[id]/send — force-promote a Draft or Scheduled email
// to Sent immediately. Used by the "Send now" action on the Scheduled
// list row and by drafts that the user wants to ship without re-opening
// the Compose modal.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EmailMessage } from '@/lib/db/models/pm/EmailMessage';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';
import { sendEmail } from '@/lib/pm/emailTransport';

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
  if (doc.status !== 'Draft' && doc.status !== 'Scheduled') {
    return NextResponse.json(
      { error: `Cannot send a ${doc.status} email` },
      { status: 409 },
    );
  }
  if (
    doc.to.length === 0 &&
    doc.cc.length === 0 &&
    doc.bcc.length === 0
  ) {
    return NextResponse.json(
      { error: 'At least one recipient is required to send' },
      { status: 400 },
    );
  }

  doc.status = 'Sent';
  // Pre-save hook stamps sentAt and clears scheduledSendTime.
  doc.scheduledSendTime = null;
  await doc.save();

  const delivery = await sendEmail({
    fromMailbox: doc.fromMailbox,
    fromName: doc.senderDisplayName,
    to: doc.to.map((r) => r.email),
    cc: doc.cc.map((r) => r.email),
    bcc: doc.bcc.map((r) => r.email),
    subject: doc.subject,
    html: doc.body,
  });
  if (!delivery.delivered && !delivery.skipped) {
    doc.status = 'Failed';
    await doc.save();
  }
  const eventType =
    !delivery.delivered && !delivery.skipped ? 'Email failed' : 'Email sent';

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EmailMessage',
    parentId: doc._id,
    eventType,
    actorUserId: ctx.userId,
    payload: {
      subject: doc.subject,
      manualSend: true,
      providerMessageId: delivery.providerMessageId,
      transportSkipped: delivery.skipped,
      transportError: delivery.error,
    },
  });

  if (doc.relatedEntityType && doc.relatedEntityId) {
    await logActivity({
      orgId: ctx.orgId,
      parentType: doc.relatedEntityType,
      parentId: doc.relatedEntityId,
      eventType,
      actorUserId: ctx.userId,
      payload: {
        emailId: String(doc._id),
        subject: doc.subject,
        manualSend: true,
        providerMessageId: delivery.providerMessageId,
        transportSkipped: delivery.skipped,
        transportError: delivery.error,
      },
    });
  }

  return NextResponse.json({
    id: String(doc._id),
    status: doc.status,
    sentAt: doc.sentAt,
    delivery,
  });
}
