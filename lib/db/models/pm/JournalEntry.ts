// JournalEntry — double-entry general ledger row (PDR_MASTER §3.19 + §3.19a).
// Every Bill, Deposit, BillPayment, and rent-charge ultimately writes one of
// these; the system's "money truth" lives here.
//
// Storage convention: every amount field is **integer cents**. Clients send
// dollars; the API multiplies by 100 (see `lib/pm/currency.ts`). This avoids
// float drift on long-running sums and matches the Stripe / accounting-stack
// industry pattern. Phase 4 Bills + BillPayment must follow suit.
//
// Lines are an embedded sub-document — JEs are atomic units; reports unwind
// via aggregation rather than querying lines independently.
//
// Invariants enforced in `pre('validate')` (BR-AC-1):
//  - lines.length >= 2
//  - at least one line with debit > 0
//  - at least one line with credit > 0
//  - each line is debit-only OR credit-only (never both, never neither)
//  - sum(debits) === sum(credits) — totalDebits/totalCredits are derived
//
// Status lifecycle:
//  Draft   → editable; never affects balances or reports
//  Posted  → immutable; counts in balances and reports
//  Voided  → flipped via /void route, which writes a paired reversing JE
//            (back-linked via reversesJournalEntryId). Reports filter out
//            `status === 'Voided'` rows.
//
// Locked-period gating (BR-AC-3) lives in `lib/pm/lockedPeriod.ts` and is
// invoked by the API routes — not the schema layer — so admin Financial
// Administrators can override.
import { Schema, model, models, Types, type Model } from 'mongoose';
import { PARENT_TYPES } from '@/lib/pm/parentTypes';
import type {
  JournalEntryScopeType,
  JournalEntryStatus,
} from '@/types/pm';

export const JOURNAL_ENTRY_STATUSES: JournalEntryStatus[] = [
  'Posted',
  'Draft',
  'Voided',
];

export const JOURNAL_ENTRY_SCOPE_TYPES: JournalEntryScopeType[] = [
  'Property',
  'Company',
];

/** Memo char cap — DECISIONS.md [G-S-27] resolved at 256 (PDR §3.19 inference). */
export const JOURNAL_ENTRY_MEMO_MAX = 256;

export interface IJournalLine {
  accountId: Types.ObjectId; // FK ChartOfAccount
  scopeType: JournalEntryScopeType;
  scopeId: Types.ObjectId | null; // Property._id or CompanyAccount._id
  unitId?: Types.ObjectId | null;
  name?: string;
  description?: string;
  debit: number; // cents
  credit: number; // cents
}

export interface IJournalEntry {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  date: Date;
  scopeType: JournalEntryScopeType;
  scopeId: Types.ObjectId | null;
  memo?: string;
  attachmentFileId?: Types.ObjectId | null;
  lines: IJournalLine[];
  totalDebits: number; // cents — derived
  totalCredits: number; // cents — derived
  status: JournalEntryStatus;
  postedAt?: Date | null;
  voidedAt?: Date | null;
  voidedByUserId?: Types.ObjectId | null;
  /** When this JE was created by voiding another JE, points back at the
   * original. Both directions allow either side to surface its partner in
   * the GL view. */
  reversesJournalEntryId?: Types.ObjectId | null;
  reversedByJournalEntryId?: Types.ObjectId | null;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const JournalLineSchema = new Schema<IJournalLine>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    scopeType: {
      type: String,
      enum: JOURNAL_ENTRY_SCOPE_TYPES,
      required: true,
    },
    scopeId: { type: Schema.Types.ObjectId, default: null },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PmUnit',
      default: null,
    },
    name: { type: String, trim: true },
    description: { type: String, trim: true, maxlength: 500 },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const JournalEntrySchema = new Schema<IJournalEntry>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    date: { type: Date, required: true },
    scopeType: {
      type: String,
      enum: JOURNAL_ENTRY_SCOPE_TYPES,
      required: true,
    },
    scopeId: { type: Schema.Types.ObjectId, default: null },
    memo: { type: String, trim: true, maxlength: JOURNAL_ENTRY_MEMO_MAX },
    attachmentFileId: {
      type: Schema.Types.ObjectId,
      ref: 'PmFile',
      default: null,
    },
    lines: {
      type: [JournalLineSchema],
      required: true,
      default: undefined, // force callers to supply
    },
    totalDebits: { type: Number, default: 0 },
    totalCredits: { type: Number, default: 0 },
    status: {
      type: String,
      enum: JOURNAL_ENTRY_STATUSES,
      required: true,
      default: 'Posted',
    },
    postedAt: { type: Date, default: null },
    voidedAt: { type: Date, default: null },
    voidedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reversesJournalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmJournalEntry',
      default: null,
    },
    reversedByJournalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmJournalEntry',
      default: null,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_journal_entries' },
);

// Index suite tuned for the three big read paths:
//   - GL list filtered by date range (most common)
//   - Account-scoped roll-ups (Financials matrix, bank register)
//   - Property-scoped roll-ups (Property → Financials tab)
JournalEntrySchema.index({ organizationId: 1, date: -1 });
JournalEntrySchema.index({
  organizationId: 1,
  'lines.accountId': 1,
  date: -1,
});
JournalEntrySchema.index({
  organizationId: 1,
  scopeType: 1,
  scopeId: 1,
  date: -1,
});
JournalEntrySchema.index({ organizationId: 1, status: 1 });

// Belt-and-braces sanity check on the PARENT_TYPES enum — the audit-log writer
// uses 'JournalEntry' as its parentType; ensure it's spelled the same way.
if (!(PARENT_TYPES as readonly string[]).includes('JournalEntry')) {
  throw new Error(
    "PARENT_TYPES is missing 'JournalEntry'. Update lib/pm/parentTypes.ts before importing JournalEntry.",
  );
}

JournalEntrySchema.pre('validate', function (next) {
  // Skip when re-saving an already-voided JE (status flip writes happen via
  // direct field assignment in the route handler; lines are not mutated).
  if (this.status === 'Voided' && this.lines && this.lines.length > 0) {
    // still recompute totals for safety
  }

  const lines = this.lines ?? [];
  if (lines.length < 2) {
    return next(new Error('A journal entry requires at least two lines.'));
  }

  let totalDebits = 0;
  let totalCredits = 0;
  let hasDebit = false;
  let hasCredit = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);

    if (debit < 0 || credit < 0) {
      return next(
        new Error(`Line ${idx + 1}: debit and credit must be non-negative.`),
      );
    }
    const debitSet = debit > 0;
    const creditSet = credit > 0;
    if (debitSet && creditSet) {
      return next(
        new Error(
          `Line ${idx + 1}: a line cannot have both a debit and a credit.`,
        ),
      );
    }
    if (!debitSet && !creditSet) {
      return next(
        new Error(`Line ${idx + 1}: each line needs either a debit or a credit.`),
      );
    }
    if (debitSet) hasDebit = true;
    if (creditSet) hasCredit = true;
    totalDebits += debit;
    totalCredits += credit;
  }

  if (!hasDebit || !hasCredit) {
    return next(
      new Error(
        'A journal entry must contain at least one debit and one credit line.',
      ),
    );
  }

  if (totalDebits !== totalCredits) {
    return next(
      new Error(
        `Unbalanced journal entry: debits (${totalDebits}) must equal credits (${totalCredits}).`,
      ),
    );
  }

  this.totalDebits = totalDebits;
  this.totalCredits = totalCredits;

  if (this.status === 'Posted' && !this.postedAt) {
    this.postedAt = new Date();
  }

  next();
});

export const JournalEntry: Model<IJournalEntry> =
  (models.PmJournalEntry as Model<IJournalEntry>) ??
  model<IJournalEntry>('PmJournalEntry', JournalEntrySchema);

export default JournalEntry;
