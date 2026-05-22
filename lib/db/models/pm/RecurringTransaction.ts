// RecurringTransaction — cadence-driven posting rule (PDR_MASTER §3.23).
// Auto-posts Check / Bill / Journal entry N days before nextDate (BR-AC-8);
// edits are non-retroactive (DECISIONS.md Phase 4).
//
// Storage: integer cents for line amounts (Phase 2 standard).
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  RecurringDuration,
  RecurringFrequency,
  RecurringPayeeType,
  RecurringTransactionType,
} from '@/types/pm';

export const RECURRING_TRANSACTION_TYPES_DB: RecurringTransactionType[] = [
  'Check',
  'Bill',
  'Journal entry',
];

export const RECURRING_FREQUENCIES_DB: RecurringFrequency[] = [
  'Weekly',
  'Monthly',
  'Quarterly',
  'Yearly',
];

export const RECURRING_DURATIONS_DB: RecurringDuration[] = [
  'Until cancelled',
  'End after N',
];

export const RECURRING_PAYEE_TYPES_DB: RecurringPayeeType[] = [
  'Vendor',
  'RentalOwner',
];

/** DECISIONS.md [G-S-26] — memo cap matches JE precedent (256). */
export const RECURRING_TRANSACTION_MEMO_MAX = 256;

export interface IRecurringAmountLine {
  scopeType: 'Property' | 'Company';
  scopeId?: Types.ObjectId | null;
  unitId?: Types.ObjectId | null;
  accountId: Types.ObjectId;
  description?: string;
  refNo?: string;
  /** Integer cents. */
  amount: number;
}

export interface IRecurringPayee {
  type: RecurringPayeeType;
  id: Types.ObjectId;
}

export interface IRecurringTransaction {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  type: RecurringTransactionType;
  payee?: IRecurringPayee | null;
  bankAccountId?: Types.ObjectId | null;
  memo?: string;
  frequency: RecurringFrequency;
  nextDate: Date;
  /** Days before nextDate to post the underlying record (BR-AC-8). */
  postNDaysInAdvance: number;
  duration: RecurringDuration;
  /** Required when duration='End after N'. */
  occurrenceCount?: number | null;
  amounts: IRecurringAmountLine[];
  queueForPrinting: boolean;
  active: boolean;
  lastPostedDate?: Date | null;
  /** Counts of postings created so far (read-only). */
  postedCount: number;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringAmountLineSchema = new Schema<IRecurringAmountLine>(
  {
    scopeType: {
      type: String,
      enum: ['Property', 'Company'],
      required: true,
      default: 'Company',
    },
    scopeId: { type: Schema.Types.ObjectId, default: null },
    unitId: { type: Schema.Types.ObjectId, ref: 'PmUnit', default: null },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    description: { type: String, trim: true, maxlength: 500 },
    refNo: { type: String, trim: true, maxlength: 60 },
    amount: { type: Number, required: true },
  },
  { _id: true },
);

const RecurringPayeeSchema = new Schema<IRecurringPayee>(
  {
    type: { type: String, enum: RECURRING_PAYEE_TYPES_DB, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const RecurringTransactionSchema = new Schema<IRecurringTransaction>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    type: {
      type: String,
      enum: RECURRING_TRANSACTION_TYPES_DB,
      required: true,
    },
    payee: { type: RecurringPayeeSchema, default: null },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBankAccount',
      default: null,
    },
    memo: {
      type: String,
      trim: true,
      maxlength: RECURRING_TRANSACTION_MEMO_MAX,
    },
    frequency: {
      type: String,
      enum: RECURRING_FREQUENCIES_DB,
      required: true,
    },
    nextDate: { type: Date, required: true },
    postNDaysInAdvance: { type: Number, required: true, default: 5, min: 0 },
    duration: {
      type: String,
      enum: RECURRING_DURATIONS_DB,
      required: true,
      default: 'Until cancelled',
    },
    occurrenceCount: { type: Number, default: null },
    amounts: {
      type: [RecurringAmountLineSchema],
      required: true,
      default: undefined,
    },
    queueForPrinting: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    lastPostedDate: { type: Date, default: null },
    postedCount: { type: Number, default: 0 },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_recurring_transactions' },
);

RecurringTransactionSchema.index({
  organizationId: 1,
  active: 1,
  nextDate: 1,
});
RecurringTransactionSchema.index({ organizationId: 1, 'payee.id': 1 });

RecurringTransactionSchema.pre('validate', function (next) {
  if (this.type !== 'Journal entry' && !this.payee?.id) {
    return next(
      new Error('payee is required when type is Check or Bill (BR-AC-9).'),
    );
  }
  if (this.duration === 'End after N' && (!this.occurrenceCount || this.occurrenceCount < 1)) {
    return next(
      new Error('occurrenceCount must be a positive integer when duration is "End after N".'),
    );
  }
  if (!this.amounts || this.amounts.length < 1) {
    return next(new Error('At least one amounts line is required.'));
  }
  next();
});

export const RecurringTransaction: Model<IRecurringTransaction> =
  (models.PmRecurringTransaction as Model<IRecurringTransaction>) ??
  model<IRecurringTransaction>(
    'PmRecurringTransaction',
    RecurringTransactionSchema,
  );

export default RecurringTransaction;
