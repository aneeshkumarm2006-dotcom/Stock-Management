// CompanyAccount — the management company's own books (PDR_MASTER §3.28).
// One per Organization. Holds the default cash account that the "Company cash"
// hero card aggregates and serves as `scope.id` for JE lines that don't belong
// to any specific Property (e.g. management-fee income, owner draws).
//
// Phase 2 surface is the model + idempotent seeder + admin CRUD. The richer
// Company financials page lands in Phase 9.
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface ICompanyAccount {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  defaultCashAccountId?: Types.ObjectId | null;
  active: boolean;
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
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_company_accounts' },
);

CompanyAccountSchema.index({ organizationId: 1, active: 1 });

export const CompanyAccount: Model<ICompanyAccount> =
  (models.PmCompanyAccount as Model<ICompanyAccount>) ??
  model<ICompanyAccount>('PmCompanyAccount', CompanyAccountSchema);

export default CompanyAccount;
