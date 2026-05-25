// EmailMessage list + compose (PDR_MASTER §3.35, Phase 6).
//
// GET /api/pm/emails
//   - `view=sent|scheduled|drafts|threads` — chooses the bucket. Default `sent`.
//   - `relatedEntityType` + `relatedEntityId` — polymorphic Comms tab anchor.
//   - `showSystemGenerated=1` — toggles BR-CC-4 default-hide behaviour.
//   - `q` — substring match on subject (case-insensitive, regex-escaped).
//   - `from` / `to` — ISO date range against `sentAt` (sent view) or
//     `scheduledSendTime` (scheduled) or `updatedAt` (drafts).
//   - `page` / `pageSize` — 1-indexed pagination (default 1 / 25).
//   - `countOnly=1` — returns `{ count }` for sub-tab badges (BR-CC-3).
//
// POST /api/pm/emails
//   - body: `EmailMessageCreateInput` with `action: 'send'|'schedule'|'draft'`.
//   - Server-side: resolves polymorphic recipient refs into flat
//     `{ email, name }` entries (BR-CC-8 analogue), computes a deterministic
//     thread grouping key, upserts the matching EmailThread, persists the
//     message, stamps `sentAt` / `scheduledSendTime`, and writes activity
//     log entries on the email itself AND (when set) on the related entity
//     so the Event-history tab on Vendor/Property/etc surfaces the send.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EmailMessage } from '@/lib/db/models/pm/EmailMessage';
import {
  EmailThread,
  computeThreadGroupingKey,
} from '@/lib/db/models/pm/EmailThread';
import { PmFile } from '@/lib/db/models/pm/PmFile';
import { User } from '@/lib/db/models/User';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  emailMessageCreateSchema,
  EMAIL_ATTACHMENT_MAX_BYTES,
  hasDeniedExtension,
} from '@/lib/validation/pm/emailMessage';
import {
  resolveRecipients,
  type RecipientInput,
} from '@/lib/pm/emailRecipientResolver';
import { logActivity } from '@/lib/pm/activity';
import { resolveSenderMailbox } from '@/lib/pm/mailbox';
import { sendEmail } from '@/lib/pm/emailTransport';
import type { EmailStatus, ParentType } from '@/types/pm';

export const runtime = 'nodejs';

interface EmailRow {
  _id: unknown;
  subject: string;
  fromMailbox: string;
  to: Array<{ type: string; email: string; name?: string }>;
  cc: Array<{ type: string; email: string; name?: string }>;
  bcc: Array<{ type: string; email: string; name?: string }>;
  recipientCount: number;
  status: EmailStatus;
  isSystemGenerated: boolean;
  readReceiptStatus: string;
  sentAt?: Date | null;
  scheduledSendTime?: Date | null;
  senderDisplayName: string;
  relatedEntityType?: string | null;
  relatedEntityId?: unknown;
  threadId?: unknown;
  updatedAt: Date;
  createdAt: Date;
}

function viewToStatusFilter(view: string): EmailStatus | null {
  if (view === 'sent') return 'Sent';
  if (view === 'scheduled') return 'Scheduled';
  if (view === 'drafts') return 'Draft';
  return null;
}

function dateFieldForView(view: string): keyof EmailRow {
  if (view === 'scheduled') return 'scheduledSendTime';
  if (view === 'drafts') return 'updatedAt';
  return 'sentAt';
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const view = (searchParams.get('view') ?? 'sent').toLowerCase();
  const relatedEntityType = searchParams.get('relatedEntityType');
  const relatedEntityId = searchParams.get('relatedEntityId');
  const showSystemGenerated = searchParams.get('showSystemGenerated') === '1';
  const q = searchParams.get('q')?.trim();
  const fromDate = searchParams.get('from');
  const toDate = searchParams.get('to');
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get('pageSize') ?? '25')),
  );
  const countOnly = searchParams.get('countOnly') === '1';

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };

  if (view === 'threads') {
    // Threads view queries the EmailThread collection instead. Branch early
    // so the EmailMessage filter logic stays clean.
    const threadFilter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(ctx.orgId),
    };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      threadFilter.subject = rx;
    }
    if (countOnly) {
      const count = await EmailThread.countDocuments(threadFilter);
      return NextResponse.json({ count });
    }
    const total = await EmailThread.countDocuments(threadFilter);
    const threads = await EmailThread.find(threadFilter)
      .sort({ lastActivityTime: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    return NextResponse.json({
      view,
      total,
      page,
      pageSize,
      items: threads.map((t) => ({
        id: String(t._id),
        subject: t.subject,
        participants: t.participants ?? [],
        participantCount: t.participantCount,
        messageCount: t.messageCount,
        lastActivityTime: t.lastActivityTime,
      })),
    });
  }

  const status = viewToStatusFilter(view);
  if (status) filter.status = status;

  if (relatedEntityType && relatedEntityId) {
    filter.relatedEntityType = relatedEntityType;
    if (Types.ObjectId.isValid(relatedEntityId)) {
      filter.relatedEntityId = new Types.ObjectId(relatedEntityId);
    } else {
      // Bad id → return empty result rather than 500.
      return NextResponse.json({
        view,
        total: 0,
        page,
        pageSize,
        items: [],
      });
    }
  }

  if (!showSystemGenerated) {
    filter.isSystemGenerated = false;
  }

  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.subject = rx;
  }

  const dateField = dateFieldForView(view);
  if (fromDate || toDate) {
    const range: Record<string, Date> = {};
    if (fromDate) range.$gte = new Date(fromDate);
    if (toDate) range.$lte = new Date(toDate);
    filter[dateField] = range;
  }

  if (countOnly) {
    const count = await EmailMessage.countDocuments(filter);
    return NextResponse.json({ count });
  }

  const sortField =
    view === 'scheduled' ? 'scheduledSendTime' : view === 'drafts' ? 'updatedAt' : 'sentAt';
  const sortDir = view === 'scheduled' ? 1 : -1;
  const total = await EmailMessage.countDocuments(filter);
  const rows = await EmailMessage.find(filter)
    .sort({ [sortField]: sortDir, _id: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean<EmailRow[]>();

  return NextResponse.json({
    view,
    total,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: String(r._id),
      subject: r.subject,
      fromMailbox: r.fromMailbox,
      to: r.to,
      cc: r.cc,
      bcc: r.bcc,
      recipientCount: r.recipientCount,
      status: r.status,
      isSystemGenerated: r.isSystemGenerated,
      readReceiptStatus: r.readReceiptStatus,
      sentAt: r.sentAt ?? null,
      scheduledSendTime: r.scheduledSendTime ?? null,
      senderDisplayName: r.senderDisplayName,
      relatedEntityType: r.relatedEntityType ?? null,
      relatedEntityId: r.relatedEntityId ? String(r.relatedEntityId) : null,
      threadId: r.threadId ? String(r.threadId) : null,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    })),
  });
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

  const parsed = emailMessageCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgOid = new Types.ObjectId(ctx.orgId);

  // Attachment validation: ensure all PmFile rows exist in this org, none
  // exceed the byte cap, and none are denied extensions.
  if (parsed.data.attachmentFileIds.length > 0) {
    const ids = parsed.data.attachmentFileIds.map((id) => new Types.ObjectId(id));
    const files = await PmFile.find({
      _id: { $in: ids },
      organizationId: orgOid,
    })
      .select('fileSize originalFilename')
      .lean<
        Array<{
          _id: Types.ObjectId;
          fileSize?: number;
          originalFilename?: string;
        }>
      >();
    if (files.length !== parsed.data.attachmentFileIds.length) {
      return NextResponse.json(
        { error: 'One or more attachmentFileIds not found in this org' },
        { status: 400 },
      );
    }
    for (const f of files) {
      const label = f.originalFilename ?? String(f._id);
      if (
        typeof f.fileSize === 'number' &&
        f.fileSize > EMAIL_ATTACHMENT_MAX_BYTES
      ) {
        return NextResponse.json(
          { error: `Attachment "${label}" exceeds the 25MB per-file cap` },
          { status: 400 },
        );
      }
      if (f.originalFilename && hasDeniedExtension(f.originalFilename)) {
        return NextResponse.json(
          { error: `Attachment "${label}" has a denied file extension` },
          { status: 400 },
        );
      }
    }
  }

  // Resolve polymorphic recipients into flat snapshots. Property/Lease
  // entries expand to their active Tenants server-side.
  const toResolved = await resolveRecipients(
    ctx.orgId,
    parsed.data.to as RecipientInput[],
  );
  const ccResolved = await resolveRecipients(
    ctx.orgId,
    parsed.data.cc as RecipientInput[],
  );
  const bccResolved = await resolveRecipients(
    ctx.orgId,
    parsed.data.bcc as RecipientInput[],
  );

  if (
    parsed.data.action === 'send' &&
    toResolved.length === 0 &&
    ccResolved.length === 0 &&
    bccResolved.length === 0
  ) {
    return NextResponse.json(
      { error: 'No recipients resolved — every entity selected lacked an email on file' },
      { status: 400 },
    );
  }

  // Resolve the sender mailbox: explicit override → org per-property →
  // org default. The compose payload already includes whatever the client
  // chose; if missing, fall back to the org default.
  const fromMailbox =
    parsed.data.fromMailbox ||
    (await resolveSenderMailbox({
      orgId: ctx.orgId,
      propertyId: parsed.data.fromMailboxPropertyId ?? null,
    })) ||
    '';
  if (!fromMailbox) {
    return NextResponse.json(
      {
        error:
          'No sender mailbox configured. Set Organization.senderMailbox.defaultFrom in Settings → Mailboxes.',
      },
      { status: 400 },
    );
  }

  // Look up the sender's display name from the User collection so the
  // historical email snapshot doesn't drift if the user later renames.
  const senderUser = await User.findById(ctx.userId)
    .select('name email')
    .lean<{ _id: Types.ObjectId; name: string; email: string } | null>();
  const senderDisplayName = senderUser?.name || senderUser?.email || 'Property Manager';

  // Status mapping from action discriminator.
  const status: EmailStatus =
    parsed.data.action === 'send'
      ? 'Sent'
      : parsed.data.action === 'schedule'
      ? 'Scheduled'
      : 'Draft';

  // Thread upsert keyed by (normalized subject, sorted participants).
  const participantEmails = [
    fromMailbox,
    ...toResolved.map((r) => r.email),
    ...ccResolved.map((r) => r.email),
    ...bccResolved.map((r) => r.email),
  ];
  const groupingKey = computeThreadGroupingKey(
    parsed.data.subject,
    participantEmails,
  );
  const uniqParticipants = Array.from(
    new Set(participantEmails.map((e) => e.toLowerCase())),
  );
  let threadId: Types.ObjectId | null = null;
  if (status !== 'Draft') {
    // Drafts don't belong to a thread until the user actually sends/schedules.
    const thread = await EmailThread.findOneAndUpdate(
      { organizationId: orgOid, groupingKey },
      {
        $setOnInsert: {
          organizationId: orgOid,
          subject: parsed.data.subject,
          groupingKey,
        },
        $set: { lastActivityTime: new Date() },
        $inc: { messageCount: 1 },
        $addToSet: {
          participants: { $each: uniqParticipants.map((email) => ({ email })) },
        },
      },
      { upsert: true, new: true },
    );
    await EmailThread.updateOne(
      { _id: thread._id },
      { $set: { participantCount: thread.participants.length } },
    );
    threadId = thread._id;
  }

  const message = await EmailMessage.create({
    organizationId: orgOid,
    fromMailbox: fromMailbox.toLowerCase(),
    fromMailboxPropertyId: parsed.data.fromMailboxPropertyId
      ? new Types.ObjectId(parsed.data.fromMailboxPropertyId)
      : null,
    subject: parsed.data.subject,
    body: parsed.data.body,
    to: toResolved.map((r) => ({
      type: r.type,
      id: r.id,
      email: r.email,
      name: r.name,
    })),
    cc: ccResolved.map((r) => ({
      type: r.type,
      id: r.id,
      email: r.email,
      name: r.name,
    })),
    bcc: bccResolved.map((r) => ({
      type: r.type,
      id: r.id,
      email: r.email,
      name: r.name,
    })),
    attachmentFileIds: parsed.data.attachmentFileIds.map(
      (id) => new Types.ObjectId(id),
    ),
    senderUserId: new Types.ObjectId(ctx.userId),
    senderDisplayName,
    status,
    isSystemGenerated: parsed.data.isSystemGenerated ?? false,
    readReceiptStatus: 'Not tracked',
    scheduledSendTime: parsed.data.scheduledSendTime
      ? new Date(parsed.data.scheduledSendTime)
      : null,
    templateId: parsed.data.templateId
      ? new Types.ObjectId(parsed.data.templateId)
      : null,
    threadId,
    relatedEntityType: parsed.data.relatedEntityType ?? null,
    relatedEntityId: parsed.data.relatedEntityId
      ? new Types.ObjectId(parsed.data.relatedEntityId)
      : null,
  });

  // Transport: only fire on real send. Failures flip the row to 'Failed'
  // and surface in the response so the UI can warn the user.
  let delivery: {
    delivered: boolean;
    skipped?: boolean;
    providerMessageId?: string;
    error?: string;
  } | null = null;
  if (status === 'Sent') {
    delivery = await sendEmail({
      fromMailbox,
      fromName: senderDisplayName,
      to: toResolved.map((r) => r.email),
      cc: ccResolved.map((r) => r.email),
      bcc: bccResolved.map((r) => r.email),
      subject: parsed.data.subject,
      html: parsed.data.body,
    });
    if (!delivery.delivered && !delivery.skipped) {
      message.status = 'Failed';
      await message.save();
    }
  }

  // Activity log on the email itself. Demote to 'Email failed' when the
  // provider rejected the send.
  const baseEventType =
    status === 'Sent'
      ? delivery && !delivery.delivered && !delivery.skipped
        ? 'Email failed'
        : 'Email sent'
      : status === 'Scheduled'
      ? 'Email scheduled'
      : 'Email draft saved';
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EmailMessage',
    parentId: message._id,
    eventType: baseEventType,
    actorUserId: ctx.userId,
    payload: {
      subject: parsed.data.subject,
      recipientCount: message.recipientCount,
      action: parsed.data.action,
      ...(delivery
        ? {
            providerMessageId: delivery.providerMessageId,
            transportSkipped: delivery.skipped,
            transportError: delivery.error,
          }
        : {}),
    },
  });
  const eventType = baseEventType;

  // Mirror activity log onto the related entity (so its Event-history tab
  // surfaces the send). Cast: EMAIL_RELATED_ENTITY_TYPES is a strict
  // subset of PARENT_TYPES, but the Zod enum widens to string.
  if (parsed.data.relatedEntityType && parsed.data.relatedEntityId) {
    await logActivity({
      orgId: ctx.orgId,
      parentType: parsed.data.relatedEntityType as ParentType,
      parentId: parsed.data.relatedEntityId,
      eventType,
      actorUserId: ctx.userId,
      payload: {
        emailId: String(message._id),
        subject: parsed.data.subject,
        recipientCount: message.recipientCount,
      },
    });
  }

  return NextResponse.json(
    {
      id: String(message._id),
      status: message.status,
      threadId: threadId ? String(threadId) : null,
      recipientCount: message.recipientCount,
      delivery: delivery ?? undefined,
    },
    { status: 201 },
  );
}
