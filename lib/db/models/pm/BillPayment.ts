// BillPayment — payment applied against a Bill (PDR_MASTER §3.22).
// Posts a JournalEntry on create (debit A/P, credit BankAccount cash CoA);
// pulls Bill.status forward to `Partially paid` or `Paid` based on sum
// against Bill.amount. Storage: integer cents (Phase 2 convention).
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { BillPaymentMethod } from '@/types/pm';
import { WarningSchema, type IWarning } from './_shared/WarningSchema';

export const BILL_PAYMENT_METHODS_DB: BillPaymentMethod[] = [
  'Check',
  'ACH',
  'EFT',
  'Wire',
];

export interface IBillPayment {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  billId: Types.ObjectId;
  bankAccountId?: Types.ObjectId | null;
  paymentMethod: BillPaymentMethod;
  /** Required iff paymentMethod === 'Check'. */
  checkNumber?: string;
  /** Integer cents. */
  amount: number;
  paidDate: Date;
  journalEntryId?: Types.ObjectId | null;
  createdByUserId: Types.ObjectId;
  warnings: IWarning[];
  createdAt: Date;
  updatedAt: Date;
}

const BillPaymentSchema = new Schema<IBillPayment>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    billId: { type: Schema.Types.ObjectId, ref: 'PmBill', required: true },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBankAccount',
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: BILL_PAYMENT_METHODS_DB,
      default: 'Check',
    },
    checkNumber: { type: String, trim: true, maxlength: 30 },
    amount: { type: Number, default: 0, min: 0 },
    paidDate: { type: Date, default: null },
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmJournalEntry',
      default: null,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    warnings: { type: [WarningSchema], default: [] },
  },
  { timestamps: true, collection: 'pm_bill_payments' },
);

BillPaymentSchema.index({ organizationId: 1, billId: 1, paidDate: -1 });
BillPaymentSchema.index({ organizationId: 1, bankAccountId: 1, paidDate: -1 });

// Removed: the "checkNumber required when method=Check" hard check moved to
// computeWarnings (MISSING_CHECK_NUMBER). The payment row saves either way;
// downstream reconciliation skips payments that carry this warning.

export const BillPayment: Model<IBillPayment> =
  (models.PmBillPayment as Model<IBillPayment>) ??
  model<IBillPayment>('PmBillPayment', BillPaymentSchema);

export default BillPayment;
