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
import type {
  ApprovalDecision,
  EftPayeeType,
  EftRequestStatus,
} from '@/types/pm';
import { APPROVAL_DECISIONS } from '@/types/pm';

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

/** Phase 9 — one signed decision per approver in the chain (BR-AC-19).
 *  Chain is evaluated left-to-right; a single `Rejected` decision ends
 *  the chain with `EftRequest.status='Rejected'`. */
export interface IEftApproval {
  userId: Types.ObjectId;
  decision: ApprovalDecision;
  at: Date;
  comment?: string;
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
  /** Phase 4 single-approver pointer. Phase 9 multi-approver flow
   *  (BR-AC-19) treats this as the "final approver" snapshot — the user
   *  whose decision flipped the chain to terminal `Approved`. Empty
   *  while a multi-approver chain is mid-flight. */
  approverUserId?: Types.ObjectId | null;
  /** Phase 9 — ordered ledger of every approver decision in the chain.
   *  Empty for legacy/single-approver requests. */
  approvals: IEftApproval[];
  /** Phase 9 — snapshot of the ApprovalRule that gated this request at
   *  create time. Null when no rule matched (single-approver fallback). */
  appliedRuleId?: Types.ObjectId | null;
  /** Cents. */
  amount: number;
  /** Set on approve. */
  journalEntryId?: Types.ObjectId | null;
  /** Set on reject. */
  rejectionReason?: string;
  /** Linked Bill the EFT settles, if any. */
  billId?: Types.ObjectId | null;
  /** Phase 9 — multi-approver chain (BR-AC-19, [G-S-31]).
   *  Snapshot of the resolved ApprovalRule at create time so subsequent
   *  edits to the rule don't change in-flight EFTs.
   *  - `requiredApproverUserIds`: set the rule expects to sign.
   *  - `receivedApprovals[]`: who has signed so far; `all-of` semantics
   *    waits until every required approver appears here, `any-of` posts
   *    as soon as one does.
   *  Empty `requiredApproverUserIds` reverts to the Phase 4 single-approver
   *  flow (anyone with `FinancialAdministrator` clicks Approve). */
  approvalRuleId?: Types.ObjectId | null;
  requiredApproverUserIds: Types.ObjectId[];
  approvalSemantics?: 'any-of' | 'all-of' | null;
  receivedApprovals: {
    userId: Types.ObjectId;
    approvedAt: Date;
  }[];
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

const EftApprovalSchema = new Schema<IEftApproval>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    decision: {
      type: String,
      enum: APPROVAL_DECISIONS,
      required: true,
    },
    at: { type: Date, required: true, default: () => new Date() },
    comment: { type: String, trim: true, maxlength: 2000 },
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
    approvals: { type: [EftApprovalSchema], default: [] },
    appliedRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'PmApprovalRule',
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
    approvalRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'PmApprovalRule',
      default: null,
    },
    requiredApproverUserIds: [
      { type: Schema.Types.ObjectId, ref: 'User' },
    ],
    approvalSemantics: {
      type: String,
      enum: ['any-of', 'all-of', null],
      default: null,
    },
    receivedApprovals: {
      type: [
        new Schema(
          {
            userId: {
              type: Schema.Types.ObjectId,
              ref: 'User',
              required: true,
            },
            approvedAt: { type: Date, required: true, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
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
