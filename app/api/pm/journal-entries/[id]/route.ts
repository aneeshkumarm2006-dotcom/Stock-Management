// Per-row JournalEntry CRUD.
// PATCH is only valid for Draft entries — Posted is immutable; use the
// /void route to retire one. DELETE is rejected outright (Voided is the
// canonical "gone" state because we keep the audit chain).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { journalEntryUpdateSchema } from '@/lib/validation/pm/journalEntry';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import { serializeJournalEntry } from '../route';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return JournalEntry.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(
    serializeJournalEntry(doc.toObject() as unknown as Record<string, unknown>),
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = journalEntryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.status === 'Voided') {
    return NextResponse.json(
      { error: 'Voided entries are immutable' },
      { status: 409 },
    );
  }
  if (doc.status === 'Posted' && parsed.data.status !== 'Draft') {
    // Posted is immutable; we allow flipping to Draft only as a recovery path
    // and even that is gated to admins below.
    return NextResponse.json(
      { error: 'Posted journal entries are immutable. Void instead.' },
      { status: 409 },
    );
  }

  if (parsed.data.date) {
    const newDate = new Date(parsed.data.date);
    if (Number.isNaN(newDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }
    try {
      await assertWriteAllowed({
        orgId: ctx.orgId,
        txnDate: newDate,
        scopePropertyId:
          doc.scopeType === 'Property' && doc.scopeId
            ? String(doc.scopeId)
            : null,
        ctx,
      });
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        return NextResponse.json(
          { error: err.policyMessage, policyId: err.policyId },
          { status: 423 },
        );
      }
      throw err;
    }
    doc.date = newDate;
  }
  if (parsed.data.memo !== undefined) doc.memo = parsed.data.memo;
  if (parsed.data.attachmentFileId !== undefined) {
    doc.attachmentFileId = parsed.data.attachmentFileId
      ? new Types.ObjectId(parsed.data.attachmentFileId)
      : null;
  }
  if (parsed.data.lines) {
    doc.lines = parsed.data.lines.map((l) => ({
      accountId: new Types.ObjectId(l.accountId),
      scopeType: l.scopeType,
      scopeId: l.scopeId ? new Types.ObjectId(l.scopeId) : null,
      unitId: l.unitId ? new Types.ObjectId(l.unitId) : null,
      name: l.name,
      description: l.description,
      debit: toCents(l.debit),
      credit: toCents(l.credit),
    })) as typeof doc.lines;
  }
  if (parsed.data.status) doc.status = parsed.data.status;

  try {
    await doc.save();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save journal entry';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'JournalEntry',
    parentId: doc._id,
    eventType:
      doc.status === 'Posted'
        ? 'JournalEntry posted'
        : 'JournalEntry updated (Draft)',
    actorUserId: ctx.userId,
  });

  return NextResponse.json(
    serializeJournalEntry(doc.toObject() as unknown as Record<string, unknown>),
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: 'Journal entries cannot be deleted. Use POST /void to retire them.',
    },
    { status: 405 },
  );
}
