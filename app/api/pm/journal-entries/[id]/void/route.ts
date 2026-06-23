// POST /api/pm/journal-entries/:id/void
//
// Voiding a Posted JE flips the original to status=Voided and writes a paired
// reversing JE (debits ↔ credits) so reports that filter `status !== 'Voided'`
// still net to zero without losing the audit trail. The reversing JE is
// itself Posted (so it counts) and back-links via reversesJournalEntryId.
//
// Locked-period gating applies — the reversing entry's date matches the
// original's date, so an admin override is required if the original date is
// inside a lock window.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import { reverseJournalEntry } from '@/lib/pm/reverseJournalEntry';
import { serializeJournalEntry } from '../../serialize';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const original = await JournalEntry.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgObjectId,
  });
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (original.status === 'Voided') {
    return NextResponse.json(
      { error: 'Journal entry is already voided' },
      { status: 409 },
    );
  }
  if (original.status === 'Draft') {
    // Drafts never hit the ledger, so they can simply be flipped without
    // writing a reversing entry. The PATCH path could also handle this; we
    // mirror it here so the UI has one void affordance.
    original.status = 'Voided';
    original.voidedAt = new Date();
    original.voidedByUserId = new Types.ObjectId(ctx.userId);
    await original.save();

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'JournalEntry',
      parentId: original._id,
      eventType: 'JournalEntry voided',
      actorUserId: ctx.userId,
      payload: { wasDraft: true },
    });

    return NextResponse.json(
      serializeJournalEntry(original.toObject() as unknown as Record<string, unknown>),
    );
  }

  // Locked-period gate on the reversal date (which matches the original).
  try {
    await assertWriteAllowed({
      orgId: ctx.orgId,
      txnDate: original.date,
      scopePropertyId:
        original.scopeType === 'Property' && original.scopeId
          ? String(original.scopeId)
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

  // Build the paired reversing entry and flip the original to Voided. The
  // helper's default memo matches the prior inline behavior exactly.
  const { reversal } = await reverseJournalEntry({ je: original, ctx });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'JournalEntry',
    parentId: original._id,
    eventType: 'JournalEntry voided',
    actorUserId: ctx.userId,
    payload: { reversingJournalEntryId: String(reversal._id) },
  });
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'JournalEntry',
    parentId: reversal._id,
    eventType: 'JournalEntry posted (reversal)',
    actorUserId: ctx.userId,
    payload: { reversesJournalEntryId: String(original._id) },
  });

  return NextResponse.json({
    voided: serializeJournalEntry(
      original.toObject() as unknown as Record<string, unknown>,
    ),
    reversal: serializeJournalEntry(
      reversal.toObject() as unknown as Record<string, unknown>,
    ),
  });
}
