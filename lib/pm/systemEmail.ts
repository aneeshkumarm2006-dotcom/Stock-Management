// System-generated email writer (BR-CC-4). Consumer phases call this when
// they need to record a transactional email (lease welcome, vendor portal
// invite, application status update, etc). Bypasses Draft/Scheduled and
// writes straight to Sent with `isSystemGenerated=true` so the default
// list view hides it (toggle "Show system generated emails" reveals).
//
// Phase 6 ships the helper; the actual call-sites land in their consuming
// phases (lease welcome on lease execute, vendor invite on vendor portal,
// etc). Real outbound SMTP is NOT wired — the helper persists the row
// and logs activity; that is the entire Phase 6 surface.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EmailMessage } from '@/lib/db/models/pm/EmailMessage';
import {
  EmailThread,
  computeThreadGroupingKey,
} from '@/lib/db/models/pm/EmailThread';
import { logActivity } from '@/lib/pm/activity';
import { sendEmail } from '@/lib/pm/emailTransport';
import type {
  EmailRecipientType,
  EmailRelatedEntityType,
} from '@/types/pm';

export interface SystemEmailRecipient {
  type: EmailRecipientType;
  id: string | Types.ObjectId | null;
  email: string;
  name?: string;
}

export interface SystemEmailInput {
  orgId: string | Types.ObjectId;
  /** Sender mailbox snapshot — usually `Organization.senderMailbox.defaultFrom`. */
  fromMailbox: string;
  senderUserId: string | Types.ObjectId;
  senderDisplayName: string;
  subject: string;
  body: string;
  to: SystemEmailRecipient[];
  cc?: SystemEmailRecipient[];
  bcc?: SystemEmailRecipient[];
  /** Optional polymorphic anchor so the email lands on a detail page's
   *  Communications tab. */
  relatedEntityType?: EmailRelatedEntityType | null;
  relatedEntityId?: string | Types.ObjectId | null;
  templateId?: string | Types.ObjectId | null;
  attachmentFileIds?: Array<string | Types.ObjectId>;
  /** Optional event-name override; defaults to `Email sent`. */
  eventType?: string;
}

function toOid(v: string | Types.ObjectId): Types.ObjectId {
  return typeof v === 'string' ? new Types.ObjectId(v) : v;
}

function toOidOrNull(
  v: string | Types.ObjectId | null | undefined,
): Types.ObjectId | null {
  if (!v) return null;
  return toOid(v);
}

/** Persist a system-generated EmailMessage and refresh the matching
 *  EmailThread row. Returns the new message id. */
export async function writeSystemEmail(
  input: SystemEmailInput,
): Promise<string> {
  await connectToDatabase();
  const orgOid = toOid(input.orgId);

  const to = input.to;
  const cc = input.cc ?? [];
  const bcc = input.bcc ?? [];
  const allRecipientEmails = [...to, ...cc, ...bcc]
    .map((r) => r.email)
    .filter(Boolean);

  // EmailThread upsert keyed by (subject, participants). Same shape as the
  // human-compose path so threads merge cleanly.
  const groupingKey = computeThreadGroupingKey(
    input.subject,
    [input.fromMailbox, ...allRecipientEmails],
  );
  const threadParticipants = Array.from(
    new Set([input.fromMailbox, ...allRecipientEmails].map((e) => e.toLowerCase())),
  );
  const thread = await EmailThread.findOneAndUpdate(
    { organizationId: orgOid, groupingKey },
    {
      $setOnInsert: {
        organizationId: orgOid,
        subject: input.subject,
        groupingKey,
      },
      $set: {
        lastActivityTime: new Date(),
      },
      $inc: { messageCount: 1 },
      $addToSet: {
        participants: {
          $each: threadParticipants.map((email) => ({ email })),
        },
      },
    },
    { upsert: true, new: true },
  );
  // Refresh participantCount post-addToSet.
  await EmailThread.updateOne(
    { _id: thread._id },
    { $set: { participantCount: thread.participants.length } },
  );

  const message = await EmailMessage.create({
    organizationId: orgOid,
    fromMailbox: input.fromMailbox.toLowerCase(),
    subject: input.subject,
    body: input.body,
    to: to.map((r) => ({
      type: r.type,
      id: toOidOrNull(r.id),
      email: r.email.toLowerCase(),
      name: r.name,
    })),
    cc: cc.map((r) => ({
      type: r.type,
      id: toOidOrNull(r.id),
      email: r.email.toLowerCase(),
      name: r.name,
    })),
    bcc: bcc.map((r) => ({
      type: r.type,
      id: toOidOrNull(r.id),
      email: r.email.toLowerCase(),
      name: r.name,
    })),
    senderUserId: toOid(input.senderUserId),
    senderDisplayName: input.senderDisplayName,
    status: 'Sent',
    isSystemGenerated: true,
    readReceiptStatus: 'Not tracked',
    templateId: toOidOrNull(input.templateId),
    attachmentFileIds: (input.attachmentFileIds ?? []).map((id) => toOid(id)),
    threadId: thread._id,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: toOidOrNull(input.relatedEntityId),
  });

  // Transport. Failure flips the row to 'Failed' and the activity log
  // event downgrades to 'Email failed' so the Comms tab surfaces the issue.
  const delivery = await sendEmail({
    fromMailbox: input.fromMailbox,
    fromName: input.senderDisplayName,
    to: to.map((r) => r.email),
    cc: cc.map((r) => r.email),
    bcc: bcc.map((r) => r.email),
    subject: input.subject,
    html: input.body,
  });
  if (!delivery.delivered && !delivery.skipped) {
    await EmailMessage.updateOne(
      { _id: message._id },
      { $set: { status: 'Failed' } },
    );
  }

  const baseEventType = input.eventType ?? 'Email sent';
  const eventType =
    !delivery.delivered && !delivery.skipped ? 'Email failed' : baseEventType;
  await logActivity({
    orgId: orgOid,
    parentType: 'EmailMessage',
    parentId: message._id,
    eventType,
    actorUserId: toOid(input.senderUserId),
    payload: {
      systemGenerated: true,
      subject: input.subject,
      recipientCount: to.length + cc.length + bcc.length,
      providerMessageId: delivery.providerMessageId,
      transportSkipped: delivery.skipped,
      transportError: delivery.error,
    },
  });

  if (input.relatedEntityType && input.relatedEntityId) {
    await logActivity({
      orgId: orgOid,
      parentType: input.relatedEntityType,
      parentId: toOid(input.relatedEntityId),
      eventType,
      actorUserId: toOid(input.senderUserId),
      payload: {
        systemGenerated: true,
        emailId: String(message._id),
        subject: input.subject,
        providerMessageId: delivery.providerMessageId,
        transportSkipped: delivery.skipped,
        transportError: delivery.error,
      },
    });
  }

  return String(message._id);
}
