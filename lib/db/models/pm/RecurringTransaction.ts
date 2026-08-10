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
import { WarningSchema, type IWarning } from './_shared/WarningSchema';
import type { AmortizationCompounding } from '@/lib/pm/amortization';

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

export const RECURRING_ALLOCATION_MODES = ['None', 'CompanyProperties'] as const;
export const RECURRING_ALLOCATION_BASES = ['Equal', 'Manual'] as const;

export type RecurringAllocationMode =
  (typeof RECURRING_ALLOCATION_MODES)[number];
export type RecurringAllocationBasis =
  (typeof RECURRING_ALLOCATION_BASES)[number];

/**
 * Split a company-level amount across that company's properties.
 *
 * PER LINE, not per rule — a mortgage and an insurance premium can sit on the
 * same rule and must diverge: mortgage interest belongs above NOI and stays on
 * the company, while insurance is an operating expense each building should
 * carry its share of.
 *
 * Stored as a subdocument rather than a boolean so basis and manual weights fit
 * without a later migration. `null`/absent/`mode:'None'` all mean "do not
 * allocate", which is why every row written before this existed behaves
 * identically with no backfill.
 */
export interface IRecurringLineAllocation {
  mode: RecurringAllocationMode;
  basis: RecurringAllocationBasis;
  /** Only consulted when basis='Manual'. */
  weights: Array<{ propertyId: Types.ObjectId; weight: number }>;
}

export interface IRecurringAmountLine {
  scopeType: 'Property' | 'Company';
  scopeId?: Types.ObjectId | null;
  unitId?: Types.ObjectId | null;
  accountId: Types.ObjectId;
  description?: string;
  refNo?: string;
  /** Integer cents. */
  amount: number;
  allocation?: IRecurringLineAllocation | null;
  /**
   * Marks THIS line as the mortgage payment, so the poster splits it into an
   * interest leg and a principal leg using the rule-level `mortgage` terms.
   *
   * A boolean rather than a line id on purpose: PATCH rebuilds `amounts[]`
   * wholesale through `mapAmountLineToDb`, which does not carry `_id`, so every
   * save regenerates the line ids and any id reference would be orphaned by the
   * first edit. Absent/false ⇒ the historical single-line behaviour, so no
   * backfill is needed.
   */
  splitAsMortgage?: boolean;
}

/**
 * Immutable loan facts for a mortgage rule. Everything else — the balance at
 * any date, this period's interest and principal — is DERIVED from these plus
 * the payment index, never stored.
 *
 * There is deliberately no `currentBalanceCents`: a rolled-back period, a
 * duplicate-suppressed period or a released claim would each leave a
 * decremented balance permanently wrong with nothing able to detect it.
 * See lib/pm/amortization.ts.
 */
export interface IRecurringMortgage {
  /** The loan's start date. The anchor the payment index counts from. */
  originationDate: Date;
  /** Original loan amount at origination, integer cents. */
  originalPrincipalCents: number;
  /** Nominal annual rate as a percentage, e.g. 5.25. */
  annualRatePct: number;
  /** Total scheduled payments over the amortization period. */
  termPeriods: number;
  /**
   * 'SemiAnnual' is the Canadian legal convention and the default; US loans use
   * 'PeriodMatched'. Worth ~$1,300 over a $1M 25-year term — confirm it against
   * a lender statement rather than guessing.
   */
  compounding: AmortizationCompounding;
  /**
   * Offset for a loan that started before it was entered here and whose true
   * origination date isn't available. Prefer the real date and leave this at 0.
   */
  paymentsAlreadyMade: number;
  /** Long-term Liability account the principal leg debits. */
  principalAccountId: Types.ObjectId;
  /** Operating Expense account the interest leg debits. */
  interestAccountId: Types.ObjectId;
  /**
   * A lender statement balance and its date. Stored as a CHECK, not as state:
   * `verify-amortization.ts --live` recomputes what our schedule says the
   * balance was on that date and reports the delta. A gap of more than a few
   * dollars means the terms are wrong and the rule must not go live.
   */
  statementBalanceCents?: number | null;
  statementDate?: Date | null;
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
  /** Loan terms, when this rule is a mortgage payment. Null otherwise. */
  mortgage?: IRecurringMortgage | null;
  queueForPrinting: boolean;
  active: boolean;
  lastPostedDate?: Date | null;
  /** Counts of postings created so far (read-only). */
  postedCount: number;
  createdByUserId: Types.ObjectId;
  warnings: IWarning[];
  createdAt: Date;
  updatedAt: Date;
}

const AllocationWeightSchema = new Schema<{
  propertyId: Types.ObjectId;
  weight: number;
}>(
  {
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      required: true,
    },
    weight: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const RecurringLineAllocationSchema = new Schema<IRecurringLineAllocation>(
  {
    mode: {
      type: String,
      enum: RECURRING_ALLOCATION_MODES as unknown as string[],
      required: true,
      default: 'None',
    },
    basis: {
      type: String,
      enum: RECURRING_ALLOCATION_BASES as unknown as string[],
      required: true,
      default: 'Equal',
    },
    weights: { type: [AllocationWeightSchema], default: [] },
  },
  { _id: false },
);

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
    // `null` = don't allocate, which is what every pre-existing row is.
    allocation: { type: RecurringLineAllocationSchema, default: null },
    // `false` = post as one line, which is what every pre-existing row is.
    splitAsMortgage: { type: Boolean, default: false },
  },
  { _id: true },
);

const RecurringMortgageSchema = new Schema<IRecurringMortgage>(
  {
    originationDate: { type: Date, required: true },
    originalPrincipalCents: { type: Number, required: true, min: 1 },
    annualRatePct: { type: Number, required: true, min: 0, max: 100 },
    termPeriods: { type: Number, required: true, min: 1, max: 1200 },
    compounding: {
      type: String,
      enum: ['SemiAnnual', 'PeriodMatched'],
      default: 'SemiAnnual',
    },
    paymentsAlreadyMade: { type: Number, default: 0, min: 0 },
    principalAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    interestAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    statementBalanceCents: { type: Number, default: null },
    statementDate: { type: Date, default: null },
  },
  { _id: false },
);

const RecurringPayeeSchema = new Schema<IRecurringPayee>(
  {
    // Sub-doc fields stay required — partial payee can't exist in DB.
    // When the form leaves the payee blank, the route stores payee: null
    // and computeWarnings stamps RECURRING_MISSING_PAYEE.
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
      default: 'Check',
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
      default: 'Monthly',
    },
    nextDate: { type: Date, default: null },
    postNDaysInAdvance: { type: Number, required: true, default: 5, min: 0 },
    duration: {
      type: String,
      enum: RECURRING_DURATIONS_DB,
      default: 'Until cancelled',
    },
    occurrenceCount: { type: Number, default: null },
    amounts: {
      type: [RecurringAmountLineSchema],
      default: [],
    },
    // `null` = not a mortgage, which is what every pre-existing rule is — so
    // deploying this is a no-op until someone configures one.
    mortgage: { type: RecurringMortgageSchema, default: null },
    queueForPrinting: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    lastPostedDate: { type: Date, default: null },
    postedCount: { type: Number, default: 0 },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    warnings: { type: [WarningSchema], default: [] },
  },
  { timestamps: true, collection: 'pm_recurring_transactions' },
);

RecurringTransactionSchema.index({
  organizationId: 1,
  active: 1,
  nextDate: 1,
});
RecurringTransactionSchema.index({ organizationId: 1, 'payee.id': 1 });

// All three checks here used to hard-block creation. They now live in
// computeWarnings (RECURRING_MISSING_PAYEE, etc.) as non-blocking amber
// warnings. The recurrence poster (BR-AC-8) must check
// `hasBlockingWarnings(doc.warnings, [...])` before generating the underlying
// Check/Bill/JE — see lib/pm/warnings.ts.

export const RecurringTransaction: Model<IRecurringTransaction> =
  (models.PmRecurringTransaction as Model<IRecurringTransaction>) ??
  model<IRecurringTransaction>(
    'PmRecurringTransaction',
    RecurringTransactionSchema,
  );

export default RecurringTransaction;
