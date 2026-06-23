// Bill email ingest webhook (BR-AC-9). Accepts a pre-parsed inbound email
// payload addressed to `<account>+bills@bills.managebuilding.com` and
// creates a Draft Bill with `createdBy = "Email ingest"`.
//
// The MIME-parsing step is out of scope here; an upstream worker (Phase 6
// or external) does that. This route trusts the parsed JSON payload.
//
// Auth & tenancy (DEL-004): this is a machine-to-machine webhook, NOT a
// user-session route. We authenticate with a Bearer `INGEST_SECRET` (the same
// secret the emails/ingest webhook uses) and resolve the owning organization
// from the inbound recipient (`to`) address — matched against
// `Organization.senderMailbox.defaultFrom` / any `perPropertyOverrides` value
// — rather than from a session. When `INGEST_SECRET` is unset we fail closed
// in production (403) and only fall through in non-production for local curl.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Bill } from '@/lib/db/models/pm/Bill';
import { Organization } from '@/lib/db/models/pm/Organization';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const ingestSchema = z.object({
  /** Inbound `To` (recipient) — e.g. `acmeco+bills@bills.managebuilding.com`. */
  to: z.string().min(1),
  from: z.string().email(),
  subject: z.string().max(500),
  body: z.string().max(20000).optional(),
  /** Optional pre-uploaded PDF attachment as PmFile id. */
  attachmentFileId: objectIdSchema.optional(),
  /** Optional dollars-and-cents amount lifted from OCR; defaults to 0. */
  amount: z.number().optional(),
  /** Default expense account for the placeholder line. */
  accountId: objectIdSchema.optional(),
  /** Optional ref/invoice number gleaned from the email subject. */
  refNo: z.string().max(60).optional(),
});

/** Bearer INGEST_SECRET. Fails closed in production when the secret is unset;
 *  dev/test fall through so local curl keeps working. */
function isAuthorized(request: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    // Fail closed in production — never accept unauthenticated ingest there.
    return process.env.NODE_ENV !== 'production';
  }
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

interface OrgMailboxRow {
  _id: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  senderMailbox?: {
    defaultFrom?: string;
    perPropertyOverrides?: Map<string, string> | Record<string, string>;
  };
}

/** Find the org whose mailbox configuration includes `address`. Mirrors the
 *  emails/ingest resolver: default first, then a per-property override scan. */
async function findOrgByMailbox(
  address: string,
): Promise<OrgMailboxRow | null> {
  const lower = address.toLowerCase();
  const byDefault = await Organization.findOne({
    'senderMailbox.defaultFrom': lower,
  })
    .select('senderMailbox ownerUserId')
    .lean<OrgMailboxRow | null>();
  if (byDefault) return byDefault;

  const allOrgs = await Organization.find({})
    .select('senderMailbox ownerUserId')
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

  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();

  // Resolve the owning org from the recipient address — never from a session.
  const owningOrg = await findOrgByMailbox(parsed.data.to);
  if (!owningOrg) {
    return NextResponse.json(
      { error: 'Recipient mailbox does not match any organization config' },
      { status: 404 },
    );
  }
  const orgObjectId = owningOrg._id;
  const actorUserId = owningOrg.ownerUserId;

  // Default to a 30-day net term — PMs can edit before posting.
  const due = new Date();
  due.setDate(due.getDate() + 30);

  const amountCents = parsed.data.amount
    ? Math.round(parsed.data.amount * 100)
    : 0;

  const lineAccountId = parsed.data.accountId
    ? new Types.ObjectId(parsed.data.accountId)
    : null;

  const bill = await Bill.create({
    organizationId: orgObjectId,
    vendorId: null,
    invoiceDate: due,
    status: 'Draft',
    memo: parsed.data.body?.slice(0, 2000) ?? `Inbound email from ${parsed.data.from}`,
    refNo: parsed.data.refNo,
    scope: { type: 'Company', id: null },
    lines: lineAccountId
      ? [
          {
            accountId: lineAccountId,
            description: parsed.data.subject,
            amount: amountCents,
          },
        ]
      : [],
    attachmentFileId: parsed.data.attachmentFileId
      ? new Types.ObjectId(parsed.data.attachmentFileId)
      : null,
    createdBy: 'Email ingest',
    createdByUserId: actorUserId,
  });

  await logActivity({
    orgId: String(orgObjectId),
    parentType: 'Bill',
    parentId: bill._id,
    eventType: 'Bill drafted from email ingest',
    actorUserId: String(actorUserId),
    payload: { from: parsed.data.from, to: parsed.data.to, subject: parsed.data.subject },
  });

  return NextResponse.json(
    { id: String(bill._id), status: bill.status, createdBy: bill.createdBy },
    { status: 201 },
  );
}
