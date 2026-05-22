// Bill email ingest webhook (BR-AC-9). Accepts a pre-parsed inbound email
// payload addressed to `<account>+bills@bills.managebuilding.com` and
// creates a Draft Bill with `createdBy = "Email ingest"`.
//
// The MIME-parsing step is out of scope here; an upstream worker (Phase 6
// or external) does that. This route trusts the parsed JSON payload.
//
// Auth model: the route requires a PM context like any other API route.
// Production deployment would put this behind a webhook-signature guard,
// but Phase 4 ships the contract first.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Bill } from '@/lib/db/models/pm/Bill';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
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

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

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
  const orgObjectId = new Types.ObjectId(ctx.orgId);

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
    dueDate: due,
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
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Bill',
    parentId: bill._id,
    eventType: 'Bill drafted from email ingest',
    actorUserId: ctx.userId,
    payload: { from: parsed.data.from, to: parsed.data.to, subject: parsed.data.subject },
  });

  return NextResponse.json(
    { id: String(bill._id), status: bill.status, createdBy: bill.createdBy },
    { status: 201 },
  );
}
