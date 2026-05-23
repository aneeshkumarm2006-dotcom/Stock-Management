// BankFeedTransaction — single bank-feed import row (PDR §3.27b,
// DECISIONS.md [G-S-33]). CSV/OFX import only; Plaid/MX integrations
// deferred. Each row points at one BankAccount, and after matching
// optionally back-links to a JournalLine via { journalEntryId,
// lineIndex }.
//
// Idempotency on re-import: when an externalRef (OFX FITID) is present
// the unique partial index on `(orgId, bankAccountId, externalRef)`
// prevents the same statement line from being inserted twice.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  BankFeedMatchStatus,
  BankFeedSource,
} from '@/types/pm';
import {
  BANK_FEED_MATCH_STATUSES,
  BANK_FEED_SOURCES,
} from '@/types/pm';

export interface IBankFeedMatchRef {
  journalEntryId: Types.ObjectId;
  lineId: Types.ObjectId;
}

export interface IBankFeedTransaction {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  source: BankFeedSource;
  importedAt: Date;
  txnDate: Date;
  description: string;
  /** Signed integer cents. Negative = debit out of the account. */
  amountCents: number;
  /** OFX FITID or CSV-row hash; null when not provided. */
  externalRef?: string | null;
  status: BankFeedMatchStatus;
  matchedJournalLine?: IBankFeedMatchRef | null;
  matchedAt?: Date | null;
  importedByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MatchRefSchema = new Schema<IBankFeedMatchRef>(
  {
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmJournalEntry',
      required: true,
    },
    lineId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const BankFeedTransactionSchema = new Schema<IBankFeedTransaction>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBankAccount',
      required: true,
    },
    source: {
      type: String,
      enum: BANK_FEED_SOURCES,
      required: true,
    },
    importedAt: { type: Date, required: true, default: () => new Date() },
    txnDate: { type: Date, required: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    amountCents: { type: Number, required: true },
    externalRef: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: BANK_FEED_MATCH_STATUSES,
      required: true,
      default: 'Unmatched',
    },
    matchedJournalLine: { type: MatchRefSchema, default: null },
    matchedAt: { type: Date, default: null },
    importedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_bank_feed_transactions' },
);

BankFeedTransactionSchema.index({
  organizationId: 1,
  bankAccountId: 1,
  status: 1,
  txnDate: -1,
});

// Idempotent OFX re-import: same FITID never inserts twice.
BankFeedTransactionSchema.index(
  { organizationId: 1, bankAccountId: 1, externalRef: 1 },
  {
    unique: true,
    partialFilterExpression: { externalRef: { $type: 'string' } },
  },
);

export const BankFeedTransaction: Model<IBankFeedTransaction> =
  (models.PmBankFeedTransaction as Model<IBankFeedTransaction>) ??
  model<IBankFeedTransaction>(
    'PmBankFeedTransaction',
    BankFeedTransactionSchema,
  );

export default BankFeedTransaction;
