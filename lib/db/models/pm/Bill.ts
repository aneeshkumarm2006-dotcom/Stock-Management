// Bill — accounts-payable invoice from a Vendor (PDR_MASTER §3.21).
//
// Storage convention: every amount in **integer cents** (Phase 2 standard).
//
// Lifecycle ([G-S-17]):
//   Draft → editable; no GL impact
//   Due → posted to JE; awaiting payment
//   Overdue → derived nightly when dueDate < today
//   Partially paid → after one or more BillPayments total < Bill.amount
//   Paid → after BillPayments sum >= Bill.amount
//   Voided → paired with a reversing JE
//
// Email ingest (BR-AC-9): Bills created via `/api/pm/bills/ingest-email` set
// `createdBy = "Email ingest"` and skip vendor resolution until a human links.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { BillScopeType, BillStatus } from '@/types/pm';

export const BILL_STATUSES_DB: BillStatus[] = [
  'Draft',
  'Due',
  'Overdue',
  'Partially paid',
  'Paid',
  'Voided',
];

export const BILL_SCOPE_TYPES_DB: BillScopeType[] = ['Property', 'Company'];

export interface IBillLine {
  accountId: Types.ObjectId; // FK ChartOfAccount
  description?: string;
  /** Integer cents. */
  amount: number;
}

export interface IBillScope {
  type: BillScopeType;
  id: Types.ObjectId | null;
}

export interface IBill {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** May be null when created via email ingest until a PM links the vendor. */
  vendorId?: Types.ObjectId | null;
  dueDate: Date;
  status: BillStatus;
  memo?: string;
  refNo?: string;
  /** Cents — total of `lines[*].amount`; recomputed in pre('validate'). */
  amount: number;
  scope: IBillScope;
  unitId?: Types.ObjectId | null;
  lines: IBillLine[];
  paidDate?: Date | null;
  approverUserIds: Types.ObjectId[];
  journalEntryId?: Types.ObjectId | null;
  attachmentFileId?: Types.ObjectId | null;
  /** Stamped at create time; 'Email ingest' when seeded via webhook. */
  createdBy: string;
  workOrderId?: Types.ObjectId | null;
  voidingJournalEntryId?: Types.ObjectId | null;
  voidedAt?: Date | null;
  voidedByUserId?: Types.ObjectId | null;
  createdByUserId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const BillLineSchema = new Schema<IBillLine>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    description: { type: String, trim: true, maxlength: 500 },
    amount: { type: Number, required: true },
  },
  { _id: true },
);

const BillScopeSchema = new Schema<IBillScope>(
  {
    type: { type: String, enum: BILL_SCOPE_TYPES_DB, required: true },
    id: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const BillSchema = new Schema<IBill>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    vendorId: { type: Schema.Types.ObjectId, ref: 'PmVendor', default: null },
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: BILL_STATUSES_DB,
      required: true,
      default: 'Draft',
    },
    memo: { type: String, trim: true, maxlength: 2000 },
    refNo: { type: String, trim: true, maxlength: 60 },
    amount: { type: Number, default: 0 },
    scope: { type: BillScopeSchema, required: true, default: () => ({ type: 'Company', id: null }) },
    unitId: { type: Schema.Types.ObjectId, ref: 'PmUnit', default: null },
    lines: {
      type: [BillLineSchema],
      required: true,
      default: undefined,
    },
    paidDate: { type: Date, default: null },
    approverUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmJournalEntry',
      default: null,
    },
    attachmentFileId: {
      type: Schema.Types.ObjectId,
      ref: 'PmFile',
      default: null,
    },
    createdBy: { type: String, required: true, default: 'Manual', trim: true, maxlength: 60 },
    workOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'PmWorkOrder',
      default: null,
    },
    voidingJournalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmJournalEntry',
      default: null,
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
      default: null,
    },
  },
  { timestamps: true, collection: 'pm_bills' },
);

BillSchema.index({ organizationId: 1, status: 1, dueDate: 1 });
BillSchema.index({ organizationId: 1, vendorId: 1, status: 1 });
BillSchema.index({ organizationId: 1, workOrderId: 1 });

BillSchema.pre('validate', function (next) {
  const lines = this.lines ?? [];
  // Drafts may carry zero lines (email ingest seeds an empty Bill until a
  // human links the vendor + accounts). Non-draft statuses require at least
  // one line so the JE has something to debit.
  if (this.status !== 'Draft' && lines.length < 1) {
    return next(new Error('A bill requires at least one line before posting.'));
  }
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!Number.isFinite(line.amount)) {
      return next(new Error(`Bill line ${i + 1}: amount must be a number.`));
    }
    total += line.amount;
  }
  this.amount = total;
  next();
});

export const Bill: Model<IBill> =
  (models.PmBill as Model<IBill>) ?? model<IBill>('PmBill', BillSchema);

export default Bill;
