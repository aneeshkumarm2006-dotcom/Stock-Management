// POST /api/pm/bank-feed-transactions/[id]/match — link an Unmatched
// BankFeedTransaction to an existing JournalLine. Sets status='Matched',
// back-links via `matchedJournalLine`, and marks the JournalLine as
// `cleared=true` immediately (early-clear: matched feed rows count as
// cleared even before the next reconciliation runs).
//
// POST /api/pm/bank-feed-transactions/[id]/match  body: { ignore: true }
//   → marks the row Ignored with no JE side-effect.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BankFeedTransaction } from '@/lib/db/models/pm/BankFeedTransaction';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const matchSchema = z
  .object({
    journalEntryId: objectIdString.optional(),
    lineId: objectIdString.optional(),
    ignore: z.boolean().optional(),
  })
  .refine((d) => d.ignore || (d.journalEntryId && d.lineId), {
    message: 'Either { ignore: true } or { journalEntryId, lineId } required.',
  });

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = matchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const bft = await BankFeedTransaction.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgObjectId,
  });
  if (!bft) {
    return NextResponse.json(
      { error: 'BankFeedTransaction not found' },
      { status: 404 },
    );
  }
  if (bft.status !== 'Unmatched') {
    return NextResponse.json(
      { error: `Cannot re-match a ${bft.status} row.` },
      { status: 409 },
    );
  }

  if (parsed.data.ignore) {
    bft.status = 'Ignored';
    bft.matchedAt = new Date();
    await bft.save();
    await logActivity({
      orgId: ctx.orgId,
      parentType: 'BankFeedTransaction',
      parentId: bft._id,
      eventType: 'Bank feed row ignored',
      actorUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true, status: bft.status });
  }

  const jeObjectId = new Types.ObjectId(parsed.data.journalEntryId!);
  const lineObjectId = new Types.ObjectId(parsed.data.lineId!);

  // Verify the JE + line exists and belongs to the org.
  const je = await JournalEntry.findOne(
    {
      _id: jeObjectId,
      organizationId: orgObjectId,
      'lines._id': lineObjectId,
    },
    { 'lines.$': 1 },
  ).lean<{ _id: Types.ObjectId; lines: { _id: Types.ObjectId }[] } | null>();
  if (!je) {
    return NextResponse.json(
      { error: 'Matching journal line not found.' },
      { status: 404 },
    );
  }

  bft.status = 'Matched';
  bft.matchedJournalLine = {
    journalEntryId: jeObjectId,
    lineId: lineObjectId,
  };
  bft.matchedAt = new Date();
  await bft.save();

  await JournalEntry.updateOne(
    {
      _id: jeObjectId,
      organizationId: orgObjectId,
      'lines._id': lineObjectId,
    },
    {
      $set: {
        'lines.$.cleared': true,
        'lines.$.clearedDate': bft.txnDate,
      },
    },
  );

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'BankFeedTransaction',
    parentId: bft._id,
    eventType: 'Bank feed row matched',
    actorUserId: ctx.userId,
    payload: {
      journalEntryId: String(jeObjectId),
      lineId: String(lineObjectId),
    },
  });

  return NextResponse.json({ ok: true, status: bft.status });
}
