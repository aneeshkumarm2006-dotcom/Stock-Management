// EftRequest — electronic funds transfer awaiting approval (PDR_MASTER §3.24).
//
// Rules:
//   - Approve posts a JE (debit AP, credit bank cash CoA) and stamps
//     `status='Approved'` + `approverUserId`.
//   - Reject sets `status='Rejected'` and DOES NOT touch the ledger
//     (BR-AC-10) — underlying Bill stays unpaid.
//   - Approved EFTs are immutable; PATCH returns 409 "must void first"
//     (§3.24).
//
// Storage: integer cents.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { EftPayeeType, EftRequestStatus } from '@/types/pm';

export const EFT_REQUEST_STATUSES_DB: EftRequestStatus[] = [
  'Pending',
  'Approved',
  'Rejected',
];

export const EFT_PAYEE_TYPES_DB: EftPayeeType[] = [
  'Vendor',
  'RentalOwner',
  'Tenant',
];

export interface IEftPayee {
  type: EftPayeeType;
  id: Types.ObjectId;
}

export interface IEftRequest {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  date: Date;
  bankAccountId: Types.ObjectId;
  paidToName: string;
  payee: IEftPayee;
  /** Optional free text capturing which property/-ies this hits. */
  propertiesScope?: string;
  status: EftRequestStatus;
  approverUserId?: Types.ObjectId | null;
  /** Cents. */
  amount: number;
  /** Set on approve. */
  journalEntryId?: Types.ObjectId | null;
  /** Set on reject. */
  rejectionReason?: string;
  /** Linked Bill the EFT settles, if any. */
  billId?: Types.ObjectId | null;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EftPayeeSchema = new Schema<IEftPayee>(
  {
    type: { type: String, enum: EFT_PAYEE_TYPES_DB, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const EftRequestSchema = new Schema<IEftRequest>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    date: { type: Date, required: true },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBankAccount',
      required: true,
    },
    paidToName: { type: String, required: true, trim: true, maxlength: 200 },
    payee: { type: EftPayeeSchema, required: true },
    propertiesScope: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: EFT_REQUEST_STATUSES_DB,
      required: true,
      default: 'Pending',
    },
    approverUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    amount: { type: Number, required: true, min: 1 },
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmJournalEntry',
      default: null,
    },
    rejectionReason: { type: String, trim: true, maxlength: 2000 },
    billId: { type: Schema.Types.ObjectId, ref: 'PmBill', default: null },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_eft_requests' },
);

EftRequestSchema.index({ organizationId: 1, status: 1, date: -1 });
EftRequestSchema.index({ organizationId: 1, 'payee.id': 1 });

export const EftRequest: Model<IEftRequest> =
  (models.PmEftRequest as Model<IEftRequest>) ??
  model<IEftRequest>('PmEftRequest', EftRequestSchema);

export default EftRequest;
