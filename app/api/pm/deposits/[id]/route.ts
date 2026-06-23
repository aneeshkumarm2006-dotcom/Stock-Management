// Per-row Deposit ops. PATCH edits memo/date only (line edits would mean
// rewriting the linked JE — out of scope for Phase 2). DELETE voids the
// Deposit AND voids the linked JE (which writes a reversal).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Deposit } from '@/lib/db/models/pm/Deposit';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { depositUpdateSchema } from '@/lib/validation/pm/deposit';
import { logActivity } from '@/lib/pm/activity';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import { reverseJournalEntry } from '@/lib/pm/reverseJournalEntry';
import { serializeDeposit } from '../serialize';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Deposit.findOne({
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
    serializeDeposit(doc.toObject() as unknown as Record<string, unknown>),
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

  const parsed = depositUpdateSchema.safeParse(body);
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
      { error: 'Voided deposits are immutable' },
      { status: 409 },
    );
  }

  if (parsed.data.date) {
    const newDate = new Date(parsed.data.date);
    if (Number.isNaN(newDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }
    try {
      await assertWriteAllowed({ orgId: ctx.orgId, txnDate: newDate, ctx });
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

  await doc.save();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Deposit',
    parentId: doc._id,
    eventType: 'Deposit updated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json(
    serializeDeposit(doc.toObject() as unknown as Record<string, unknown>),
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.status === 'Voided') {
    return NextResponse.json(
      { error: 'Deposit is already voided' },
      { status: 409 },
    );
  }

  // DEL-017 — derive the property scope from the linked JE so the lock check
  // matches Per-property policies, not just Global/Per-bank-account ones. A
  // Property-scoped deposit reversal must be blocked by a lock on its own
  // property. Load the JE once up front and reuse it for the reversal below.
  const linkedJe = doc.journalEntryId
    ? await JournalEntry.findOne({
        _id: doc.journalEntryId,
        organizationId: new Types.ObjectId(ctx.orgId),
      })
    : null;
  const scopePropertyId =
    linkedJe && linkedJe.scopeType === 'Property' && linkedJe.scopeId
      ? String(linkedJe.scopeId)
      : null;

  // Lock-check the deposit date with the derived property scope.
  try {
    await assertWriteAllowed({
      orgId: ctx.orgId,
      txnDate: doc.date,
      scopePropertyId,
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

  // Void the linked JE (we already lock-checked above, so the reversal posts
  // without re-running the gate — the shared helper performs no lock check).
  if (linkedJe && linkedJe.status === 'Posted') {
    await reverseJournalEntry({
      je: linkedJe,
      ctx,
      memo: `Reversal of deposit ${String(doc._id)}`,
    });
  }

  doc.status = 'Voided';
  doc.voidedAt = new Date();
  doc.voidedByUserId = new Types.ObjectId(ctx.userId);
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Deposit',
    parentId: doc._id,
    eventType: 'Deposit voided',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
