// Company — a per-user entity that holds positions and/or uninvested cash
// (e.g. "Ofra Iris", "Ramco"). Refs: PDR.md §6 (Position) — companies are the
// "held-by" owner a position can point at, plus a place to park liquid cash.
//
// Cash is modelled as scalar fields on the company (one balance + its native
// currency) rather than a separate collection: there is exactly one cash
// balance per company and it is edited "all in one place" on the Manage page.
// `cashCurrency` is a free 3-letter ISO code so cash can be converted to the
// display currency before it contributes to the portfolio total (PDR §9),
// exactly like a position's native currency.
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface ICompany {
  userId: Types.ObjectId; // owner; indexed, required — never client-supplied
  name: string;
  cashBalance: number; // uninvested liquid cash, in cashCurrency
  cashCurrency: string; // ISO-4217 code the cash is held in
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new Schema<ICompany>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    cashBalance: { type: Number, default: 0, min: 0 },
    cashCurrency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
    },
  },
  { timestamps: true, collection: 'companies' },
);

// Indexes: scoped list by owner; one company name per user (unique).
CompanySchema.index({ userId: 1 });
CompanySchema.index({ userId: 1, name: 1 }, { unique: true });

export const Company: Model<ICompany> =
  (models.Company as Model<ICompany>) ??
  model<ICompany>('Company', CompanySchema);

export default Company;
