// Deposit — money-in batch posted to a single BankAccount (PDR_MASTER §3.20).
// Each Deposit is the user-facing "receive funds" record; behind it a single
// JournalEntry posts a debit to the BankAccount's underlying GL cash account
// and a credit per `depositItem` to the income/liability account selected on
// each row.
//
// Storage: amounts in **integer cents** (see lib/pm/currency.ts header).
//
// Invariants (BR-AC-6, BR-AC-14):
//  - depositItems.length >= 1
//  - totalAmount is derived in `pre('validate')` — never trust the client
//  - depositItems may target different scopes (multi-property single deposit)
//
// Lifecycle:
//  Posted → steady state; references the JE that hit the ledger
//  Voided → underlying JE was voided; this Deposit also flips
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { DepositStatus, JournalEntryScopeType } from '@/types/pm';

export const DEPOSIT_STATUSES: DepositStatus[] = ['Posted', 'Voided'];

export interface IDepositItem {
  scopeType: JournalEntryScopeType;
  scopeId: Types.ObjectId | null;
  unitId?: Types.ObjectId | null;
  accountId: Types.ObjectId; // FK ChartOfAccount
  description?: string;
  refNo?: string;
  amount: number; // cents — must be > 0
}

export interface IDeposit {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  date: Date;
  memo?: string;
  totalAmount: number; // cents — derived
  depositItems: IDepositItem[];
  attachmentFileId?: Types.ObjectId | null;
  journalEntryId?: Types.ObjectId | null;
  status: DepositStatus;
  voidedAt?: Date | null;
  voidedByUserId?: Types.ObjectId | null;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DepositItemSchema = new Schema<IDepositItem>(
  {
    scopeType: {
      type: String,
      enum: ['Property', 'Company'],
      required: true,
    },
    scopeId: { type: Schema.Types.ObjectId, default: null },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PmUnit',
      default: null,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    description: { type: String, trim: true, maxlength: 500 },
    refNo: { type: String, trim: true, maxlength: 60 },
    amount: { type: Number, required: true, min: 1 },
  },
  { _id: true },
);

const DepositSchema = new Schema<IDeposit>(
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
    date: { type: Date, required: true },
    memo: { type: String, trim: true, maxlength: 2000 },
    totalAmount: { type: Number, default: 0 },
    depositItems: {
      type: [DepositItemSchema],
      required: true,
      default: undefined,
    },
    attachmentFileId: {
      type: Schema.Types.ObjectId,
      ref: 'PmFile',
      default: null,
    },
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmJournalEntry',
      default: null,
    },
    status: {
      type: String,
      enum: DEPOSIT_STATUSES,
      required: true,
      default: 'Posted',
    },
    voidedAt: { type: Date, default: null },
    voidedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_deposits' },
);

DepositSchema.index({ organizationId: 1, date: -1 });
DepositSchema.index({ organizationId: 1, bankAccountId: 1, date: -1 });
DepositSchema.index({ organizationId: 1, status: 1 });

DepositSchema.pre('validate', function (next) {
  const items = this.depositItems ?? [];
  if (items.length < 1) {
    return next(new Error('A deposit requires at least one line item.'));
  }
  let total = 0;
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!;
    if (!Number.isFinite(item.amount) || item.amount <= 0) {
      return next(
        new Error(`Deposit line ${idx + 1}: amount must be greater than zero.`),
      );
    }
    total += item.amount;
  }
  this.totalAmount = total; // BR-AC-6 — derived, ignore any client value
  next();
});

export const Deposit: Model<IDeposit> =
  (models.PmDeposit as Model<IDeposit>) ??
  model<IDeposit>('PmDeposit', DepositSchema);

export default Deposit;
