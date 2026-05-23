// Inbound email ingest stub ([G-S-44]). A future Postmark/SES inbound
// adapter normalises the provider event into the schema accepted here and
// hits this endpoint. Phase 6 wires the path so the Threads sub-route has
// real data to render once a real inbound provider lands.
//
// Authentication: Bearer INGEST_SECRET (dev-fallback when unset, mirroring
// the cron route). Multi-tenant scoping uses the `to` address — we match
// the recipient against `Organization.senderMailbox.defaultFrom` / any
// `perPropertyOverrides` value so the reply lands in the right org.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Organization } from '@/lib/db/models/pm/Organization';
import { EmailMessage } from '@/lib/db/models/pm/EmailMessage';
import {
  EmailThread,
  computeThreadGroupingKey,
} from '@/lib/db/models/pm/EmailThread';
import { emailMessageIngestSchema } from '@/lib/validation/pm/emailMessage';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true; // dev fallback
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

interface OrgMailboxRow {
  _id: Types.ObjectId;
  senderMailbox?: {
    defaultFrom?: string;
    perPropertyOverrides?: Map<string, string> | Record<string, string>;
  };
}

/** Find the org whose mailbox configuration includes `address`. Walks the
 *  default + every per-property override; first match wins. */
async function findOrgByMailbox(
  address: string,
): Promise<OrgMailboxRow | null> {
  const lower = address.toLowerCase();
  // Try the default first.
  const byDefault = await Organization.findOne({
    'senderMailbox.defaultFrom': lower,
  })
    .select('senderMailbox')
    .lean<OrgMailboxRow | null>();
  if (byDefault) return byDefault;
  // Override scan — small enough that a full collection sweep is fine for
  // the Phase 6 stub. A real provider lookup table replaces this when
  // inbound transport ships.
  const allOrgs = await Organization.find({})
    .select('senderMailbox')
    .lean<OrgMailboxRow[]>();
  for (const org of allOrgs) {
    const overrides = org.senderMailbox?.perPropertyOverrides;
    if (!overrides) continue;
    if (overrides instanceof Map) {
      for (const value of Array.from(overrides.values())) {
        if (value.toLowerCase() === lower) return org;
      }
    } else {
      for (const value of Object.values(overrides)) {
        if (value.toLowerCase() === lower) return org;
      }
    }
  }
  return null;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = emailMessageIngestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  // Determine which org owns this reply via the `to` mailbox.
  let owningOrg: OrgMailboxRow | null = null;
  for (const candidate of parsed.data.to) {
    owningOrg = await findOrgByMailbox(candidate);
    if (owningOrg) break;
  }
  if (!owningOrg) {
    return NextResponse.json(
      { error: 'Recipient mailbox does not match any organization config' },
      { status: 404 },
    );
  }

  const orgOid = owningOrg._id;
  const allParticipants = [parsed.data.from, ...parsed.data.to];
  const groupingKey = computeThreadGroupingKey(
    parsed.data.subject,
    allParticipants,
  );
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
        participants: {
          $each: Array.from(
            new Set(allParticipants.map((e) => e.toLowerCase())),
          ).map((email) => ({ email })),
        },
      },
    },
    { upsert: true, new: true },
  );
  await EmailThread.updateOne(
    { _id: thread._id },
    { $set: { participantCount: thread.participants.length } },
  );

  // Inbound replies are stored as Sent rows (status mirrors the human
  // compose path so the History view renders them uniformly). The
  // recipient mailbox becomes the "to" snapshot; the sender becomes
  // the inbound `from`. senderUserId reuses the org owner because Phase
  // 6 has no per-mailbox service-account; consumers can override later.
  const message = await EmailMessage.create({
    organizationId: orgOid,
    fromMailbox: parsed.data.from.toLowerCase(),
    subject: parsed.data.subject,
    body: parsed.data.body,
    to: parsed.data.to.map((email) => ({
      type: 'Custom',
      id: null,
      email: email.toLowerCase(),
    })),
    cc: [],
    bcc: [],
    attachmentFileIds: [],
    senderUserId: orgOid, // Phase 6 stub — real provider supplies a service account
    senderDisplayName: parsed.data.fromName || parsed.data.from,
    status: 'Sent',
    isSystemGenerated: false,
    readReceiptStatus: 'Not tracked',
    threadId: thread._id,
  });

  await logActivity({
    orgId: orgOid,
    parentType: 'EmailMessage',
    parentId: message._id,
    eventType: 'Email reply received',
    actorUserId: orgOid, // best-effort actor for an inbound event
    payload: {
      from: parsed.data.from,
      subject: parsed.data.subject,
      threadId: String(thread._id),
    },
  });

  return NextResponse.json(
    {
      id: String(message._id),
      threadId: String(thread._id),
      organizationId: String(orgOid),
    },
    { status: 201 },
  );
}
