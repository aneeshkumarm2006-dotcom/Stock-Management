// POST /api/pm/bank-feed/import — accepts a bank-feed file payload
// (CSV text + column mapping, or OFX text) and inserts
// BankFeedTransaction rows with status='Unmatched'. Re-imports are
// idempotent on externalRef (OFX FITID) via the unique partial index.
//
// Payload (JSON):
//   { bankAccountId, source: 'CSV'|'OFX', text, mapping? }
//
// The wizard reads the file client-side and posts the text body so we
// avoid the complexity of multipart parsing in a Next.js route.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BankFeedTransaction } from '@/lib/db/models/pm/BankFeedTransaction';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { parseCsv, parseOfx } from '@/lib/pm/csvOfxParser';
import { logActivity } from '@/lib/pm/activity';
import { BANK_FEED_SOURCES } from '@/types/pm';

export const runtime = 'nodejs';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const importSchema = z.object({
  bankAccountId: objectIdString,
  source: z.enum(BANK_FEED_SOURCES as readonly [string, ...string[]]),
  text: z.string().min(1),
  mapping: z
    .object({
      date: z.string(),
      description: z.string(),
      amount: z.string(),
      externalRef: z.string().optional(),
    })
    .optional(),
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
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const bankObjectId = new Types.ObjectId(parsed.data.bankAccountId);

  const bank = await BankAccount.exists({
    _id: bankObjectId,
    organizationId: orgObjectId,
  });
  if (!bank) {
    return NextResponse.json(
      { error: 'BankAccount not found' },
      { status: 404 },
    );
  }

  let rows;
  try {
    if (parsed.data.source === 'CSV') {
      if (!parsed.data.mapping) {
        return NextResponse.json(
          { error: 'CSV imports require a column mapping' },
          { status: 400 },
        );
      }
      rows = parseCsv(parsed.data.text, parsed.data.mapping);
    } else {
      rows = parseOfx(parsed.data.text);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to parse';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      await BankFeedTransaction.create({
        organizationId: orgObjectId,
        bankAccountId: bankObjectId,
        source: parsed.data.source,
        importedAt: new Date(),
        txnDate: row.txnDate,
        description: row.description,
        amountCents: row.amountCents,
        externalRef: row.externalRef ?? null,
        status: 'Unmatched',
        importedByUserId: new Types.ObjectId(ctx.userId),
      });
      inserted += 1;
    } catch (err) {
      // Unique-index collisions on externalRef are expected on re-import.
      if (err instanceof Error && /E11000/.test(err.message)) {
        skipped += 1;
      } else {
        throw err;
      }
    }
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'BankAccount',
    parentId: bankObjectId,
    eventType: 'Bank feed imported',
    actorUserId: ctx.userId,
    payload: {
      source: parsed.data.source,
      parsed: rows.length,
      inserted,
      skipped,
    },
  });

  return NextResponse.json({ inserted, skipped, parsed: rows.length });
}
