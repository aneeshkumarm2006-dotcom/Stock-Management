// Budget — annual budget grid (PDR_MASTER §3.26 + §3.26a). One Budget per
// Property per fiscal year (BR-AC-11); Company-scope budgets are not
// uniqueness-bound so multiple "what-if" company budgets can coexist for
// the same FY.
//
// Lines are embedded sub-documents. Each line stores 12 monthlyAmounts in
// integer cents; `fyTotal` is derived on read (route layer) — never
// persisted, never trusted from the wire. This keeps the round-trip simple
// (one document, one save) while still letting the reports unwind by month.
//
// `defaultAmounts` resolves three seed modes:
//   - `Zero`                     — emit lines with monthly[0..11]=0
//   - `Copy previous FY actuals` — snapshot last year's posted GL (BR-AC-11)
//   - `Copy existing budget`     — require `copySourceBudgetId` and clone
//
// Storage convention: integer cents in `monthlyAmounts[]` per the Phase 2
// money invariant (see `lib/pm/currency.ts`).
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  BudgetDefaultAmounts,
  BudgetLineCategory,
  BudgetScopeType,
  FiscalMonth,
} from '@/types/pm';
import { WarningSchema, type IWarning } from './_shared/WarningSchema';

export const BUDGET_SCOPE_TYPES_DB: BudgetScopeType[] = ['Property', 'Company'];

export const BUDGET_DEFAULT_AMOUNTS_DB: BudgetDefaultAmounts[] = [
  'Zero',
  'Copy previous FY actuals',
  'Copy existing budget',
];

export const BUDGET_LINE_CATEGORIES_DB: BudgetLineCategory[] = [
  'Income',
  'Expense',
];

export const FISCAL_MONTHS_DB: FiscalMonth[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface IBudgetLine {
  _id?: Types.ObjectId;
  accountId: Types.ObjectId;
  category: BudgetLineCategory;
  /** Always length 12, indexed 0=fiscalMonth1 .. 11=fiscalMonth12. Cents. */
  monthlyAmounts: number[];
}

export interface IBudget {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  scopeType: BudgetScopeType;
  /** Property._id when scope=Property, CompanyAccount._id when scope=Company. */
  scopeId: Types.ObjectId;
  name: string;
  fiscalYear: number;
  fiscalYearStart: FiscalMonth;
  startDate: Date;
  endDate: Date;
  defaultAmounts: BudgetDefaultAmounts;
  copySourceBudgetId?: Types.ObjectId | null;
  lines: IBudgetLine[];
  active: boolean;
  createdByUserId: Types.ObjectId;
  warnings: IWarning[];
  createdAt: Date;
  updatedAt: Date;
}

const BudgetLineSchema = new Schema<IBudgetLine>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    category: {
      type: String,
      enum: BUDGET_LINE_CATEGORIES_DB,
      required: true,
    },
    monthlyAmounts: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => Array.isArray(v) && v.length === 12,
        message: 'monthlyAmounts must be exactly 12 values (one per fiscal month).',
      },
    },
  },
  { _id: true },
);

const BudgetSchema = new Schema<IBudget>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    scopeType: {
      type: String,
      enum: BUDGET_SCOPE_TYPES_DB,
      required: true,
    },
    scopeId: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, default: '', trim: true, maxlength: 200 },
    fiscalYear: { type: Number, required: true, min: 1900, max: 2999 },
    fiscalYearStart: {
      type: String,
      enum: FISCAL_MONTHS_DB,
      required: true,
      default: 'January',
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    defaultAmounts: {
      type: String,
      enum: BUDGET_DEFAULT_AMOUNTS_DB,
      required: true,
      default: 'Zero',
    },
    copySourceBudgetId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBudget',
      default: null,
    },
    lines: { type: [BudgetLineSchema], default: [] },
    active: { type: Boolean, default: true },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    warnings: { type: [WarningSchema], default: [] },
  },
  { timestamps: true, collection: 'pm_budgets' },
);

// BR-AC-11 — one Budget per Property per fiscalYear. Partial filter scopes
// the constraint to Property-scope budgets only; Company-scope budgets are
// not constrained, mirroring Buildium's `what-if` behaviour.
BudgetSchema.index(
  { organizationId: 1, scopeType: 1, scopeId: 1, fiscalYear: 1 },
  {
    unique: true,
    partialFilterExpression: { scopeType: 'Property' },
  },
);

// Fast list query: org + active filter + sort by FY desc.
BudgetSchema.index({ organizationId: 1, active: 1, fiscalYear: -1 });

// The "copySourceBudgetId required when Copy existing budget" check moved
// to computeWarnings (BUDGET_MISSING_COPY_SOURCE). startDate/endDate
// relational check is a TYPE concern (nonsensical inversion) so it stays
// as a hard block.
BudgetSchema.pre('validate', function (next) {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) {
    return next(new Error('Budget startDate must precede endDate.'));
  }
  next();
});

export const Budget: Model<IBudget> =
  (models.PmBudget as Model<IBudget>) ??
  model<IBudget>('PmBudget', BudgetSchema);

export default Budget;
