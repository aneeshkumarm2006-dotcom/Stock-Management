// repostBillJournalEntry — keep a bill's accrual JournalEntry in sync after an
// edit by UPDATING THE EXISTING JE IN PLACE rather than reversing it and
// posting a fresh one.
//
// Why: the old reverse+repost path voided the original JE and wrote a separate
// Posted reversal. Both P&L aggregators (financials/matrix, company-financials)
// sum only `status==='Posted'` rows, so a same-amount edit left a stray Posted
// reversal that cancelled the new entry — the bill silently vanished from the
// Financials. Updating the same JE in place leaves exactly one corrected Posted
// row, so the GL and Financials stay correct and clutter-free.
//
// The caller owns the locked-period gate (it lock-checks BOTH the old JE date
// and the new invoice date up front, before any write), so this helper does NOT
// run `assertWriteAllowed` — mirroring `reverseJournalEntry`.
import { Types, type HydratedDocument } from 'mongoose';
import {
  JournalEntry,
  type IJournalEntry,
} from '@/lib/db/models/pm/JournalEntry';
import {
  buildBillJeFields,
  type PostBillToLedgerInput,
  type PostBillToLedgerResult,
} from '@/lib/pm/postBillToLedger';
import type { PmContext } from '@/lib/auth/getCurrentUser';

export interface RepostBillJournalEntryInput {
  orgId: string;
  ctx: PmContext;
  /** The bill's current accrual JE (already loaded + org-scoped), or null when
   *  the posted bill never had one / its JE is missing. */
  existingJe: HydratedDocument<IJournalEntry> | null;
  bill: PostBillToLedgerInput['bill'];
}

export async function repostBillJournalEntry(
  input: RepostBillJournalEntryInput,
): Promise<PostBillToLedgerResult> {
  const fields = await buildBillJeFields({
    orgId: input.orgId,
    bill: input.bill,
  });

  // No reusable Posted JE (missing, Draft, or already Voided) → create a fresh
  // one so a posted bill always has a live accrual entry.
  if (!input.existingJe || input.existingJe.status !== 'Posted') {
    const je = await JournalEntry.create({
      organizationId: new Types.ObjectId(input.orgId),
      date: fields.date,
      scopeType: fields.scopeType,
      scopeId: fields.scopeId,
      memo: fields.memo,
      attachmentFileId: fields.attachmentFileId,
      lines: fields.lines,
      status: 'Posted',
      createdByUserId: new Types.ObjectId(input.ctx.userId),
    });
    return { journalEntryId: je._id, totalCents: fields.totalCents };
  }

  // Update the SAME Posted JE in place. `pre('validate')` re-runs on save() and
  // re-derives totalDebits/totalCredits + re-asserts the entry balances, so the
  // rebuilt lines stay valid.
  const je = input.existingJe;
  je.date = fields.date;
  je.scopeType = fields.scopeType;
  je.scopeId = fields.scopeId;
  je.memo = fields.memo;
  je.attachmentFileId = fields.attachmentFileId;
  je.lines = fields.lines as typeof je.lines;
  await je.save();

  return { journalEntryId: je._id, totalCents: fields.totalCents };
}
