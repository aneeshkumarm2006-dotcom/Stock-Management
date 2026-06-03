// EmailMessage detail (GET / PATCH / DELETE). Phase 6.
//
// PATCH allows full-field edit only while `status='Draft'`. Once the email
// is Scheduled, only the schedule controls (`/send`, `/cancel`) can touch
// it. Sent / Failed messages are immutable.
//
// DELETE is Draft-only; Scheduled emails must be cancelled (→ Draft) first
// then deleted, so a one-step destructive flow can't silently drop a queued
// send.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EmailMessage } from '@/lib/db/models/pm/EmailMessage';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { emailMessageUpdateSchema } from '@/lib/validation/pm/emailMessage';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface RouteContext {
  params: { id: string };
}

async function loadEmail(ctx: { orgId: string }, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return EmailMessage.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const doc = await loadEmail(ctx, params.id);
  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    id: String(doc._id),
    subject: doc.subject,
    fromMailbox: doc.fromMailbox,
    fromMailboxPropertyId: doc.fromMailboxPropertyId
      ? String(doc.fromMailboxPropertyId)
      : null,
    to: doc.to,
    cc: doc.cc,
    bcc: doc.bcc,
    body: doc.body,
    attachmentFileIds: doc.attachmentFileIds.map((id) => String(id)),
    status: doc.status,
    isSystemGenerated: doc.isSystemGenerated,
    readReceiptStatus: doc.readReceiptStatus,
    sentAt: doc.sentAt ?? null,
    scheduledSendTime: doc.scheduledSendTime ?? null,
    senderUserId: doc.senderUserId ? String(doc.senderUserId) : null,
    senderDisplayName: doc.senderDisplayName,
    recipientCount: doc.recipientCount,
    templateId: doc.templateId ? String(doc.templateId) : null,
    threadId: doc.threadId ? String(doc.threadId) : null,
    relatedEntityType: doc.relatedEntityType ?? null,
    relatedEntityId: doc.relatedEntityId ? String(doc.relatedEntityId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const doc = await loadEmail(ctx, params.id);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.status !== 'Draft' && doc.status !== 'Scheduled') {
    return NextResponse.json(
      { error: `Cannot edit a ${doc.status} email` },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = emailMessageUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Only a narrow set of mutations are allowed once Scheduled (the
  // Compose UI exposes them only on Drafts; the API enforces it).
  if (doc.status === 'Scheduled') {
    const forbiddenForScheduled = new Set([
      'to',
      'cc',
      'bcc',
      'body',
      'subject',
      'attachmentFileIds',
      'templateId',
      'relatedEntityType',
      'relatedEntityId',
    ]);
    for (const key of Object.keys(parsed.data)) {
      if (forbiddenForScheduled.has(key)) {
        return NextResponse.json(
          {
            error: `Field "${key}" cannot be edited once an email is Scheduled. Cancel it first to return to Draft.`,
          },
          { status: 409 },
        );
      }
    }
  }

  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    // Coerce ObjectId string fields back to ObjectIds.
    if (k === 'attachmentFileIds' && Array.isArray(v)) {
      (doc as unknown as Record<string, unknown>)[k] = v.map(
        (id) => new Types.ObjectId(id as string),
      );
      continue;
    }
    if (k === 'relatedEntityId' && typeof v === 'string') {
      (doc as unknown as Record<string, unknown>)[k] = new Types.ObjectId(v);
      continue;
    }
    if (k === 'fromMailboxPropertyId' && typeof v === 'string') {
      (doc as unknown as Record<string, unknown>)[k] = new Types.ObjectId(v);
      continue;
    }
    if (k === 'templateId' && typeof v === 'string') {
      (doc as unknown as Record<string, unknown>)[k] = new Types.ObjectId(v);
      continue;
    }
    if (k === 'scheduledSendTime' && typeof v === 'string') {
      (doc as unknown as Record<string, unknown>)[k] = new Date(v);
      continue;
    }
    (doc as unknown as Record<string, unknown>)[k] = v;
  }

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EmailMessage',
    parentId: doc._id,
    eventType: 'Email updated',
    actorUserId: ctx.userId,
    payload: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json({ id: String(doc._id), status: doc.status });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const doc = await loadEmail(ctx, params.id);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.status !== 'Draft') {
    return NextResponse.json(
      {
        error: `Only Draft emails can be deleted. Cancel a Scheduled email first.`,
      },
      { status: 409 },
    );
  }

  await doc.deleteOne();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EmailMessage',
    parentId: doc._id,
    eventType: 'Email draft deleted',
    actorUserId: ctx.userId,
    payload: { subject: doc.subject },
  });
  return NextResponse.json({ ok: true });
}
