// BankAccount — referenced by Property.operatingAccountId /
// depositTrustAccountId, and by every Phase 2+ JE / Deposit / Bill. Account
// numbers are stored masked (BR-AC-13). Soft-archive via active=false
// (BR-AC-18). Derived fields (`balance`, `undepositedFunds`) are computed by
// the route on read against Phase 2 JournalLine roll-ups; Phase 1 returns
// zeros. Refs: PDR_MASTER §3.16; DECISIONS.md [G-S-15], [G-S-34].
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { BankAccountType } from '@/types/pm';

export const BANK_ACCOUNT_TYPES: BankAccountType[] = ['Checking', 'Savings', 'Cash'];

// Masked digits: optional leading mask glyphs followed by 2-4 visible digits.
// Accepts patterns like `****1234`, `••5678`, `xxxx12`, or `1234`.
export const MASKED_ACCOUNT_REGEX = /^[*•·.x]{0,12}\d{2,4}$/;

export interface IBankAccount {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  purpose?: string;
  accountNumberMasked: string;
  type: BankAccountType;
  epayEnabled: boolean;
  retailCashEnabled: boolean;
  lastReconciliationDate?: Date | null;
  isCompanyCash: boolean;
  isDefault: boolean;
  /** Phase 2 — FK to the underlying GL cash account. Required for JE/Deposit
   * postings to route through this bank account into the General Ledger.
   * Optional in the schema so legacy Phase 1 rows still load; the create
   * modal nudges users to set it and JE/Deposit routes refuse to post when
   * the source bank account has no mapping. */
  chartOfAccountId?: Types.ObjectId | null;
  /** Phase 9 — HOA per-association tag (BR-AC-20). Free-text label
   *  ("Pine Ridge HOA", "Reserve") that the Financials matrix and
   *  Company financials roll-up use to keep operating vs reserve funds
   *  visually segregated. DECISIONS.md [BR-AC-20] defers a full
   *  Association entity until a dedicated HOA module ships. */
  associationName?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BankAccountSchema = new Schema<IBankAccount>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    purpose: { type: String, trim: true },
    accountNumberMasked: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v: string) => MASKED_ACCOUNT_REGEX.test(v),
        message: 'Account number must be masked (e.g. ****1234)',
      },
    },
    type: { type: String, enum: BANK_ACCOUNT_TYPES, required: true },
    epayEnabled: { type: Boolean, default: false },
    retailCashEnabled: { type: Boolean, default: false },
    lastReconciliationDate: { type: Date, default: null },
    isCompanyCash: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    chartOfAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      default: null,
    },
    associationName: {
      type: String,
      trim: true,
      maxlength: 60,
      default: null,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_bank_accounts' },
);

// Index for the common org-scoped list query.
BankAccountSchema.index({ organizationId: 1, active: 1, name: 1 });

export const BankAccount: Model<IBankAccount> =
  (models.PmBankAccount as Model<IBankAccount>) ??
  model<IBankAccount>('PmBankAccount', BankAccountSchema);

export default BankAccount;
