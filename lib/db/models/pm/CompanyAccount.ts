// CompanyAccount — a legal entity that owns properties and keeps its own books
// (PDR_MASTER §3.28).
//
// Originally one per Organization. An org may own several entities — Ramco
// Development Inc. and Immeubles Greene Inc. each sign their own mortgages and
// insurance policies — so a row is now the thing a Company-scoped ledger row
// points at via `scopeId`, exactly as JournalEntry.ts and Budget.ts have always
// documented. `seedCompanyAccount` still creates the first one from the org
// name; additional rows come from POST /api/pm/company-accounts.
//
// A Company-scoped row with `scopeId: null` predates named companies and means
// "the organization's own books". Those are never backfilled — see the
// backward-compatibility note in lib/db/models/pm/JournalEntry.ts.
import { Schema, model, models, Types, type Model } from 'mongoose';
import { PM_CURRENCIES, type PmCurrency } from '@/types/pm';
import { WarningSchema, type IWarning } from './_shared/WarningSchema';

export interface ICompanyAccount {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  defaultCashAccountId?: Types.ObjectId | null;
  /**
   * Currency this entity books in.
   *
   * OPTIONAL BY DESIGN, mirroring `Property.currency`: `undefined` means
   * "inherit Organization.defaultCurrency", which is how every existing
   * company-scoped amount was already interpreted. Resolve via
   * `resolveCompanyCurrency()` in lib/pm/currency.ts — never read this raw or
   * you lose the org fallback.
   *
   * This is what decides which properties a company-level cost may be split
   * across: the ledger never converts on write, so a CAD premium cannot be
   * apportioned to a building that books in USD.
   */
  currency?: PmCurrency | null;
  active: boolean;
  /** Present so the generic dismiss endpoint has somewhere to write. */
  warnings: IWarning[];
  createdAt: Date;
  updatedAt: Date;
}

const CompanyAccountSchema = new Schema<ICompanyAccount>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    defaultCashAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBankAccount',
      default: null,
    },
    // No `default:` on purpose — see the doc comment above.
    currency: {
      type: String,
      enum: PM_CURRENCIES as unknown as string[],
      required: false,
    },
    active: { type: Boolean, default: true },
    warnings: { type: [WarningSchema], default: [] },
  },
  { timestamps: true, collection: 'pm_company_accounts' },
);

CompanyAccountSchema.index({ organizationId: 1, active: 1 });

// Two companies with the same name would be indistinguishable in every scope
// dropdown, and picking the wrong one silently splits the ledger in half. The
// collection holds a handful of rows, so the build is instantaneous.
CompanyAccountSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const CompanyAccount: Model<ICompanyAccount> =
  (models.PmCompanyAccount as Model<ICompanyAccount>) ??
  model<ICompanyAccount>('PmCompanyAccount', CompanyAccountSchema);

export default CompanyAccount;
