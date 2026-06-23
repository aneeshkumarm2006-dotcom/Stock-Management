// reverseJournalEntry — write a paired reversing JournalEntry for a Posted JE
// and flip the original to Voided. Reversing a JE is the system's "undo": each
// line's debit↔credit are swapped so reports that filter out `status==='Voided'`
// rows still net to zero without losing the audit trail (BR-AC, see the JE
// /void route and JournalEntry model header).
//
// This was duplicated by hand in two places:
//   - app/api/pm/journal-entries/[id]/void/route.ts
//   - app/api/pm/deposits/[id]/route.ts (DELETE)
// and is now reused by the Bill edit re-post path.
//
// The caller owns the locked-period gate. We do NOT run `assertWriteAllowed`
// here so a caller can check BOTH an old date (this reversal) and a new date
// (a subsequent re-post) up front and bail before any write. This matches the
// deposit DELETE, which lock-checks before invoking the reversal.
import { Types, type HydratedDocument } from 'mongoose';
import {
  JournalEntry,
  JOURNAL_ENTRY_MEMO_MAX,
  type IJournalEntry,
} from '@/lib/db/models/pm/JournalEntry';
import type { PmContext } from '@/lib/auth/getCurrentUser';

export interface ReverseJournalEntryInput {
  /** A hydrated, Posted JournalEntry document (already loaded + org-scoped). */
  je: HydratedDocument<IJournalEntry>;
  ctx: PmContext;
  /** Override the reversal memo. Defaults to "Reversal of JE <id> — <memo>". */
  memo?: string;
}

export interface ReverseJournalEntryResult {
  reversal: HydratedDocument<IJournalEntry>;
}

export async function reverseJournalEntry({
  je,
  ctx,
  memo,
}: ReverseJournalEntryInput): Promise<ReverseJournalEntryResult> {
  if (je.status !== 'Posted') {
    // Drafts never hit the ledger; Voided is already reversed. Callers handle
    // those cases explicitly (the void route keeps its own Draft→flip shortcut).
    throw new Error('Only a Posted journal entry can be reversed.');
  }

  const reversingLines = je.lines.map((line) => ({
    accountId: line.accountId,
    scopeType: line.scopeType,
    scopeId: line.scopeId,
    unitId: line.unitId,
    name: line.name,
    description: line.description ? `Reversal: ${line.description}` : 'Reversal',
    debit: line.credit, // swap
    credit: line.debit,
  })) as typeof je.lines;

  const reversal = await JournalEntry.create({
    organizationId: je.organizationId,
    date: je.date,
    scopeType: je.scopeType,
    scopeId: je.scopeId,
    memo: (
      memo ??
      `Reversal of JE ${String(je._id)}${je.memo ? ` — ${je.memo}` : ''}`
    ).slice(0, JOURNAL_ENTRY_MEMO_MAX),
    attachmentFileId: null,
    lines: reversingLines,
    status: 'Posted',
    reversesJournalEntryId: je._id,
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  je.status = 'Voided';
  je.voidedAt = new Date();
  je.voidedByUserId = new Types.ObjectId(ctx.userId);
  je.reversedByJournalEntryId = reversal._id;
  await je.save();

  return { reversal };
}
