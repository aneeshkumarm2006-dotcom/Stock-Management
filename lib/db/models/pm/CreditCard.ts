// CreditCard — separate from BankAccount per DECISIONS.md [G-S-29]. Surfaced
// as the Credit cards tab on /properties/accounting/banking. `balance` is
// derived (returns 0 in Phase 1; Phase 4 wires Bill-payment roll-up).
// Card numbers stored masked (BR-AC-13). Refs: PDR_MASTER §3.17.
import { Schema, model, models, Types, type Model } from 'mongoose';
import { MASKED_ACCOUNT_REGEX } from '@/lib/db/models/pm/BankAccount';

export interface ICreditCard {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  cardNumberMasked: string;
  issuer?: string;
  expirationDate?: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CreditCardSchema = new Schema<ICreditCard>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    cardNumberMasked: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v: string) => MASKED_ACCOUNT_REGEX.test(v),
        message: 'Card number must be masked (e.g. ****1234)',
      },
    },
    issuer: { type: String, trim: true },
    expirationDate: { type: Date, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_credit_cards' },
);

CreditCardSchema.index({ organizationId: 1, active: 1, name: 1 });

export const CreditCard: Model<ICreditCard> =
  (models.PmCreditCard as Model<ICreditCard>) ??
  model<ICreditCard>('PmCreditCard', CreditCardSchema);

export default CreditCard;
