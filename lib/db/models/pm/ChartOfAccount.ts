// ChartOfAccount — GL accounts referenced by every JournalLine in Phase 2+
// and by Vendor.expenseAccountId / Lease.primaryRent.accountId in Phases 3-4.
// System-seeded rows cannot be deleted (BR-AC-4); user-added rows are deletable
// only while no JournalEntry references them (Phase 2 enforces — Phase 1 the
// hook is wired but trivially passes since JE doesn't exist yet). One account
// per `defaultFor` role per org (BR-AC-5). Soft-archive via active=false
// (BR-AC-18). Refs: PDR_MASTER §3.18; DECISIONS.md [G-S-12], [G-S-13], [G-S-14].
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  ChartOfAccountType,
  CashFlowClassification,
  ChartOfAccountDefaultFor,
} from '@/types/pm';

export const CHART_OF_ACCOUNT_TYPES: ChartOfAccountType[] = [
  'Current Asset',
  'Current Asset (cash)',
  'Fixed Asset',
  'Current Liability',
  'Long-term Liability',
  'Equity',
  'Income',
  'Operating Expense',
];

export const CASH_FLOW_CLASSIFICATIONS: CashFlowClassification[] = [
  'Operating activities',
  'Investing activities',
  'Financing activities',
  'N/A',
];

export const CHART_OF_ACCOUNT_DEFAULT_FOR: ChartOfAccountDefaultFor[] = [
  'Accounts Payable',
  'Accounts Receivable',
  'Application Fee Income',
  'Bank Fees',
  'Bank Service Charges',
  'Convenience Fee',
  'Interest Income',
  'Investment Income',
  "Last Month's Rent",
  'Late Fee Income',
  'Management Fee Expense',
  'Management Fee Income',
  'Operating Cash',
  'Owner Contribution',
  'Security Deposit Liability',
  'Undeposited Funds',
];

export interface IChartOfAccount {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  type: ChartOfAccountType;
  /**
   * Parent group for a nested chart of accounts (Change §0B). `null` for
   * top-level rows. Group rows (`isGroup: true`) are non-postable headers;
   * leaves post exactly as before. Reports still aggregate by leaf accountId,
   * so grouping is presentation-only.
   */
  parentId?: Types.ObjectId | null;
  /** True for non-postable group/header rows. Hidden in account pickers. */
  isGroup: boolean;
  defaultFor?: ChartOfAccountDefaultFor | null;
  cashFlowClassification?: CashFlowClassification;
  accountNumber?: string;
  notes?: string;
  systemSeeded: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChartOfAccountSchema = new Schema<IChartOfAccount>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: CHART_OF_ACCOUNT_TYPES, required: true },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      default: null,
    },
    isGroup: { type: Boolean, default: false },
    defaultFor: {
      type: String,
      enum: CHART_OF_ACCOUNT_DEFAULT_FOR,
      default: null,
    },
    cashFlowClassification: {
      type: String,
      enum: CASH_FLOW_CLASSIFICATIONS,
      default: 'N/A',
    },
    accountNumber: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    systemSeeded: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_chart_of_accounts' },
);

// One row per (org, name). The Ramco seed names sibling leaves distinctly
// (e.g. "Bank Fees CAD$" / "Bank Fees USD$") so a flat name remains unique
// even under different groups (Change §0B).
ChartOfAccountSchema.index({ organizationId: 1, name: 1 }, { unique: true });

// Nested-chart lookups: fetch a group's children, or all top-level rows.
ChartOfAccountSchema.index({ organizationId: 1, parentId: 1 });

// BR-AC-5: one account per `defaultFor` role per org. Partial filter avoids
// the "many nulls collide" pitfall of a plain unique index.
ChartOfAccountSchema.index(
  { organizationId: 1, defaultFor: 1 },
  {
    unique: true,
    partialFilterExpression: { defaultFor: { $type: 'string' } },
  },
);

export const ChartOfAccount: Model<IChartOfAccount> =
  (models.PmChartOfAccount as Model<IChartOfAccount>) ??
  model<IChartOfAccount>('PmChartOfAccount', ChartOfAccountSchema);

export default ChartOfAccount;
