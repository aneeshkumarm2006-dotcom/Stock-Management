// Reconciliation — bank reconciliation session (PDR_MASTER §3.16 + BR-AC-17).
// Tracks the start/end period for a single reconciliation pass over one
// BankAccount, the statement balance the user is reconciling against, and
// the set of JournalLines marked cleared during the session.
//
// Lifecycle:
//   - `In progress`  — wizard open; cleared[] grows as the user ticks rows
//   - `Completed`    — locks the underlying period (BR-AC-17); stamps
//                       `lastReconciliationDate` on the parent BankAccount.
//                       Cleared JE lines become read-only for non-Admin users;
//                       uncleared lines remain editable.
//   - `Voided`       — explicit undo; LockedPeriodPolicy is deactivated
//                       and the BankAccount.lastReconciliationDate is rolled
//                       back to the previous Completed run.
//
// `clearedJournalLineIds` is a denormalised list of (jeId, lineSubdocId) pairs.
// The cleared state is also written to a derived LockedPeriodPolicy so the
// existing `assertWriteAllowed` helper picks it up without a parallel code path.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { ReconciliationStatus } from '@/types/pm';

export const RECONCILIATION_STATUSES_DB: ReconciliationStatus[] = [
  'In progress',
  'Completed',
  'Voided',
];

export interface IClearedLineRef {
  journalEntryId: Types.ObjectId;
  lineId: Types.ObjectId;
}

export interface IReconciliation {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  status: ReconciliationStatus;
  /** Inclusive lower bound; defaults to the prior reconciliation's endDate +1d. */
  startDate: Date;
  /** Inclusive upper bound — the statement-end date. */
  endDate: Date;
  /** Statement balance (cents) the user is reconciling against. */
  statementEndingBalance: number;
  /** Computed at completion: sum of cleared debits − sum of cleared credits + opening. */
  bookEndingBalance: number;
  /** statementEndingBalance − bookEndingBalance (cents). Should be 0 to allow completion. */
  difference: number;
  clearedLines: IClearedLineRef[];
  /** When completed, the LockedPeriodPolicy auto-issued to lock the period.
   *  Voiding the reconciliation deactivates this policy. */
  lockedPeriodPolicyId?: Types.ObjectId | null;
  notes?: string;
  startedByUserId: Types.ObjectId;
  completedByUserId?: Types.ObjectId | null;
  completedAt?: Date | null;
  voidedByUserId?: Types.ObjectId | null;
  voidedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ClearedLineRefSchema = new Schema<IClearedLineRef>(
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

const ReconciliationSchema = new Schema<IReconciliation>(
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
    status: {
      type: String,
      enum: RECONCILIATION_STATUSES_DB,
      required: true,
      default: 'In progress',
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    statementEndingBalance: { type: Number, required: true },
    bookEndingBalance: { type: Number, default: 0 },
    difference: { type: Number, default: 0 },
    clearedLines: { type: [ClearedLineRefSchema], default: [] },
    lockedPeriodPolicyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmLockedPeriodPolicy',
      default: null,
    },
    notes: { type: String, trim: true, maxlength: 2000 },
    startedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    completedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    completedAt: { type: Date, default: null },
    voidedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    voidedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'pm_reconciliations' },
);

ReconciliationSchema.index({
  organizationId: 1,
  bankAccountId: 1,
  status: 1,
  endDate: -1,
});
// Only one in-progress reconciliation per (org, bankAccount) at a time —
// guards against two managers double-reconciling the same statement.
ReconciliationSchema.index(
  { organizationId: 1, bankAccountId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'In progress' },
  },
);

ReconciliationSchema.pre('validate', function (next) {
  if (this.startDate && this.endDate && this.startDate > this.endDate) {
    return next(new Error('Reconciliation startDate must be on or before endDate.'));
  }
  next();
});

export const Reconciliation: Model<IReconciliation> =
  (models.PmReconciliation as Model<IReconciliation>) ??
  model<IReconciliation>('PmReconciliation', ReconciliationSchema);

export default Reconciliation;
