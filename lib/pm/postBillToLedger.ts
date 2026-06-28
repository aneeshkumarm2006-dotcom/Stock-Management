// postBillToLedger — invoked by `POST /api/pm/bills` when the bill is
// recorded as anything other than Draft (BR-MV-8). Builds a balanced
// JournalEntry: each `bill.lines[*]` becomes a debit line; the
// org-default `Accounts Payable` CoA is the offsetting credit (BR-AC-4).
//
// Locked-period gating (BR-AC-3) runs BEFORE the JE is written so the
// route can return 423 with a clean message instead of half-creating
// records.
//
// Mirrors the Deposit → JE wiring at `app/api/pm/deposits/route.ts`
// (lines 140–180).
import { Types } from 'mongoose';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import {
  JournalEntry,
  type IJournalLine,
} from '@/lib/db/models/pm/JournalEntry';
import type { JournalEntryScopeType } from '@/types/pm';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import type { PmContext } from '@/lib/auth/getCurrentUser';

export interface BillLedgerLine {
  /** FK ChartOfAccount. */
  accountId: Types.ObjectId;
  description?: string;
  /** Cents (already converted by the caller). */
  amount: number;
}

export interface PostBillToLedgerInput {
  orgId: string;
  ctx: PmContext;
  bill: {
    _id: Types.ObjectId;
    invoiceDate: Date;
    memo?: string;
    vendorId?: Types.ObjectId | null;
    scopePropertyId?: Types.ObjectId | string | null;
    lines: BillLedgerLine[];
    attachmentFileId?: Types.ObjectId | null;
  };
}

export interface PostBillToLedgerResult {
  journalEntryId: Types.ObjectId;
  totalCents: number;
}

/** The shape of an accrual JournalEntry derived from a bill — everything
 *  needed to either create a fresh JE or update an existing one in place. */
export interface BillJeFields {
  date: Date;
  scopeType: JournalEntryScopeType;
  scopeId: Types.ObjectId | null;
  memo: string;
  attachmentFileId: Types.ObjectId | null;
  lines: IJournalLine[];
  totalCents: number;
}

/**
 * Pure builder for a bill's accrual JE fields: looks up the org-default
 * Accounts Payable CoA and turns `bill.lines[*]` into debits offset by a
 * single AP credit. Does NO DB writes and NO locked-period check — the caller
 * owns those, so this can be reused both when creating a new JE
 * (`postBillToLedger`) and when re-posting an edited bill in place
 * (`repostBillJournalEntry`). Throws if AP is unconfigured or the total is zero.
 */
export async function buildBillJeFields(input: {
  orgId: string;
  bill: PostBillToLedgerInput['bill'];
}): Promise<BillJeFields> {
  const orgObjectId = new Types.ObjectId(input.orgId);
  const scopePropertyId = input.bill.scopePropertyId
    ? String(input.bill.scopePropertyId)
    : null;

  const ap = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Accounts Payable',
  }).lean<{ _id: Types.ObjectId } | null>();
  if (!ap) {
    throw new Error(
      'No Accounts Payable chart-of-accounts row is set for this org. Configure one in Settings → Chart of Accounts before recording bills.',
    );
  }

  let total = 0;
  for (const line of input.bill.lines) {
    if (!Number.isFinite(line.amount)) {
      throw new Error('Bill lines must have numeric amounts.');
    }
    total += line.amount;
  }
  if (total === 0) {
    throw new Error('Bill total must be non-zero.');
  }

  const scopeType: JournalEntryScopeType = scopePropertyId
    ? 'Property'
    : 'Company';
  const scopeId = scopePropertyId ? new Types.ObjectId(scopePropertyId) : null;

  const debits = input.bill.lines.map((l) => ({
    accountId: l.accountId,
    scopeType,
    scopeId,
    unitId: null,
    name: undefined,
    description: l.description ?? '',
    debit: l.amount,
    credit: 0,
  }));

  const credit = {
    accountId: ap._id,
    scopeType,
    scopeId,
    unitId: null,
    name: undefined,
    description: 'Bill payable',
    debit: 0,
    credit: total,
  };

  return {
    date: input.bill.invoiceDate,
    scopeType,
    scopeId,
    memo: input.bill.memo ? `Bill — ${input.bill.memo}`.slice(0, 256) : 'Bill',
    attachmentFileId: input.bill.attachmentFileId ?? null,
    lines: [...debits, credit] as unknown as IJournalLine[],
    totalCents: total,
  };
}

export async function postBillToLedger(
  input: PostBillToLedgerInput,
): Promise<PostBillToLedgerResult> {
  const orgObjectId = new Types.ObjectId(input.orgId);
  const scopePropertyId = input.bill.scopePropertyId
    ? String(input.bill.scopePropertyId)
    : null;

  await assertWriteAllowed({
    orgId: input.orgId,
    txnDate: input.bill.invoiceDate,
    scopePropertyId,
    ctx: input.ctx,
  });

  const fields = await buildBillJeFields({ orgId: input.orgId, bill: input.bill });

  const je = await JournalEntry.create({
    organizationId: orgObjectId,
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

export { LockedPeriodError };
