// DraftLease — pre-execution lease record (PDR_MASTER §3.4). Lives in its
// own URL space `/properties/leasing/draft-leases/...` (BR-LL-8) and in its
// own Mongo collection, but every field shape that overlaps with the Active
// Lease (rent, deposits, recurring/one-time charges) is intentionally
// identical so the DraftLease → Active Lease promotion can do a straight
// copy without coercion (BR-LL — "same record promotes" interpreted as
// state-machine continuity, not literal _id reuse).
//
// Lifecycle (executionStatus):
//   Draft → Out for signature → Ready to execute → Executed → (Cancelled)
//
// Cancelled is reversible per [G-B-1] (returns the unit to listable state).
// On Executed the route handler:
//   1. Builds a Lease from the draft snapshot
//   2. Sets DraftLease.executionStatus = 'Executed' and back-links
//      `promotedToLeaseId`
//   3. Auto-checks Stage 3 Move-in items on the approved Applicants
//
// Move-in charges may be paid via the Applicant Center BEFORE execution
// (BR-LL-11). The `moveInCharges[]` array carries the same shape as the
// active lease's `oneTimeCharges[]`; payment status is tracked per row.
//
// File cap: BR-PU-7 caps `files[]` at 10. Enforced in the Zod validator
// upstream; we re-check on save for defence-in-depth.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  EsignatureStatus,
  LeaseType,
  DraftLeaseExecutionStatus,
  RentCycle,
} from '@/types/pm';
import {
  ESIGNATURE_STATUSES,
  LEASE_TYPES,
  DRAFT_LEASE_EXECUTION_STATUSES,
  RENT_CYCLES,
} from '@/types/pm';

/** Memo cap shared with active Lease (BR-PU-6). */
export const LEASE_MEMO_MAX = 100;

/** File cap for inline lease uploads (BR-PU-7). */
export const LEASE_INLINE_FILE_CAP = 10;

export interface IDraftLeaseTenantRef {
  /** May be null while a draft is built before tenants are promoted from
   *  Applicants. */
  tenantId?: Types.ObjectId | null;
  /** First-class snapshot — preserves the value even if the Tenant doc is
   *  deleted before the lease executes. */
  firstName: string;
  lastName: string;
  email?: string;
  isCosigner: boolean;
}

export interface IDraftLeaseApprovedApplicantRef {
  applicantId: Types.ObjectId;
  firstName: string;
  lastName: string;
}

export interface IDraftLeaseSplitRentCharge {
  accountId: Types.ObjectId;
  amount: number; // cents
  memo?: string;
}

export interface IDraftLeasePrimaryRent {
  amount: number; // cents
  accountId: Types.ObjectId; // ChartOfAccount FK — typically Rental Income
  nextDueDate?: Date | null;
  memo?: string;
}

export interface IDraftLeaseRecurringCharge {
  amount: number; // cents
  accountId: Types.ObjectId;
  frequency: RentCycle;
  nextDate?: Date | null;
  memo?: string;
  postNDaysInAdvance: number;
}

export interface IDraftLeaseOneTimeCharge {
  amount: number; // cents
  accountId: Types.ObjectId;
  dueDate?: Date | null;
  memo?: string;
  /** Payable via Applicant Center before execution (BR-LL-11). */
  isMoveInCharge: boolean;
  paidAt?: Date | null;
  paidByApplicantId?: Types.ObjectId | null;
}

export interface IDraftLeaseLateFeePolicy {
  enabled: boolean;
  feeAmount?: number; // cents
  feePctOfRent?: number; // percent (0-100)
  daysAfterDue?: number;
  capAmount?: number; // cents
}

export interface IDraftLeaseEsigDocument {
  fileId?: Types.ObjectId | null;
  /** Distinguishes the primary lease from addendums. */
  role: 'Lease' | 'Addendum';
  label: string;
  status: EsignatureStatus;
  sentAt?: Date | null;
  signedAt?: Date | null;
}

export interface IDraftLease {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  draftId: number; // monotonic per-org
  signatureStatus: EsignatureStatus;
  esignatureStatus: EsignatureStatus;
  executionStatus: DraftLeaseExecutionStatus;
  propertyId: Types.ObjectId;
  unitId: Types.ObjectId;
  leaseType: LeaseType;
  startDate?: Date | null;
  endDate?: Date | null;
  leasingAgentUserId?: Types.ObjectId | null;
  approvedApplicants: IDraftLeaseApprovedApplicantRef[];
  tenants: IDraftLeaseTenantRef[];
  cosigners: IDraftLeaseTenantRef[];
  rentCycle: RentCycle;
  primaryRent: IDraftLeasePrimaryRent;
  splitRentCharges: IDraftLeaseSplitRentCharge[];
  securityDeposit: number; // cents
  recurringCharges: IDraftLeaseRecurringCharge[];
  oneTimeCharges: IDraftLeaseOneTimeCharge[];
  moveInCharges: IDraftLeaseOneTimeCharge[];
  lateFeePolicy: IDraftLeaseLateFeePolicy;
  residentCenterWelcomeEmail: boolean;
  esignatureDocuments: IDraftLeaseEsigDocument[];
  comments?: string;
  recentNotes?: string;
  files: Types.ObjectId[]; // PmFile refs, capped at 10
  /** Set when the draft promotes; one-way pointer to active Lease. */
  promotedToLeaseId?: Types.ObjectId | null;
  promotedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledByUserId?: Types.ObjectId | null;
  customFields: Map<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const TenantRefSchema = new Schema<IDraftLeaseTenantRef>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'PmTenant', default: null },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    isCosigner: { type: Boolean, default: false },
  },
  { _id: false },
);

const ApplicantRefSchema = new Schema<IDraftLeaseApprovedApplicantRef>(
  {
    applicantId: {
      type: Schema.Types.ObjectId,
      ref: 'PmApplicant',
      required: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const SplitRentSchema = new Schema<IDraftLeaseSplitRentCharge>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    memo: { type: String, trim: true, maxlength: LEASE_MEMO_MAX },
  },
  { _id: false },
);

const PrimaryRentSchema = new Schema<IDraftLeasePrimaryRent>(
  {
    amount: { type: Number, required: true, min: 0 },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    nextDueDate: { type: Date, default: null },
    memo: { type: String, trim: true, maxlength: LEASE_MEMO_MAX },
  },
  { _id: false },
);

const RecurringChargeSchema = new Schema<IDraftLeaseRecurringCharge>(
  {
    amount: { type: Number, required: true, min: 0 },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    frequency: { type: String, enum: RENT_CYCLES, required: true },
    nextDate: { type: Date, default: null },
    memo: { type: String, trim: true, maxlength: LEASE_MEMO_MAX },
    postNDaysInAdvance: { type: Number, default: 5, min: 0, max: 30 },
  },
  { _id: false },
);

const OneTimeChargeSchema = new Schema<IDraftLeaseOneTimeCharge>(
  {
    amount: { type: Number, required: true, min: 0 },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    dueDate: { type: Date, default: null },
    memo: { type: String, trim: true, maxlength: LEASE_MEMO_MAX },
    isMoveInCharge: { type: Boolean, default: false },
    paidAt: { type: Date, default: null },
    paidByApplicantId: {
      type: Schema.Types.ObjectId,
      ref: 'PmApplicant',
      default: null,
    },
  },
  { _id: true },
);

const LateFeeSchema = new Schema<IDraftLeaseLateFeePolicy>(
  {
    enabled: { type: Boolean, default: false },
    feeAmount: { type: Number, default: 0, min: 0 },
    feePctOfRent: { type: Number, default: 0, min: 0, max: 100 },
    daysAfterDue: { type: Number, default: 5, min: 0 },
    capAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const EsigDocSchema = new Schema<IDraftLeaseEsigDocument>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'PmFile', default: null },
    role: { type: String, enum: ['Lease', 'Addendum'], default: 'Lease' },
    label: { type: String, required: true, trim: true, maxlength: 200 },
    status: {
      type: String,
      enum: ESIGNATURE_STATUSES,
      default: 'Not sent',
    },
    sentAt: { type: Date, default: null },
    signedAt: { type: Date, default: null },
  },
  { _id: true },
);

const DraftLeaseSchema = new Schema<IDraftLease>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    draftId: { type: Number, required: true },
    signatureStatus: {
      type: String,
      enum: ESIGNATURE_STATUSES,
      default: 'Unknown',
    },
    esignatureStatus: {
      type: String,
      enum: ESIGNATURE_STATUSES,
      default: 'Not sent',
    },
    executionStatus: {
      type: String,
      enum: DRAFT_LEASE_EXECUTION_STATUSES,
      default: 'Draft',
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      required: true,
    },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PmUnit',
      required: true,
    },
    leaseType: { type: String, enum: LEASE_TYPES, required: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    leasingAgentUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedApplicants: { type: [ApplicantRefSchema], default: () => [] },
    tenants: { type: [TenantRefSchema], default: () => [] },
    cosigners: { type: [TenantRefSchema], default: () => [] },
    rentCycle: { type: String, enum: RENT_CYCLES, default: 'Monthly' },
    primaryRent: {
      type: PrimaryRentSchema,
      required: true,
    },
    splitRentCharges: { type: [SplitRentSchema], default: () => [] },
    securityDeposit: { type: Number, default: 0, min: 0 },
    recurringCharges: { type: [RecurringChargeSchema], default: () => [] },
    oneTimeCharges: { type: [OneTimeChargeSchema], default: () => [] },
    moveInCharges: { type: [OneTimeChargeSchema], default: () => [] },
    lateFeePolicy: { type: LateFeeSchema, default: () => ({ enabled: false }) },
    residentCenterWelcomeEmail: { type: Boolean, default: false },
    esignatureDocuments: { type: [EsigDocSchema], default: () => [] },
    comments: { type: String, maxlength: 4000 },
    recentNotes: { type: String, maxlength: 4000 },
    files: {
      type: [{ type: Schema.Types.ObjectId, ref: 'PmFile' }],
      default: [],
      validate: {
        validator: (v: unknown[]) => v.length <= LEASE_INLINE_FILE_CAP,
        message: `Draft lease inline file uploads cap at ${LEASE_INLINE_FILE_CAP} (BR-PU-7).`,
      },
    },
    promotedToLeaseId: {
      type: Schema.Types.ObjectId,
      ref: 'PmLease',
      default: null,
    },
    promotedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
  },
  { timestamps: true, collection: 'pm_draft_leases' },
);

DraftLeaseSchema.index(
  { organizationId: 1, draftId: 1 },
  { unique: true },
);
DraftLeaseSchema.index({ organizationId: 1, propertyId: 1, unitId: 1 });
DraftLeaseSchema.index({ organizationId: 1, executionStatus: 1 });

// BR-LL-1 — Fixed leases require start + end; At-will doesn't need end.
DraftLeaseSchema.pre('validate', function (next) {
  if (this.leaseType === 'Fixed' || this.leaseType === 'Fixed w/rollover') {
    if (!this.startDate) {
      return next(new Error('Fixed-term draft requires a startDate.'));
    }
    if (!this.endDate) {
      return next(new Error('Fixed-term draft requires an endDate.'));
    }
    if (this.endDate <= this.startDate) {
      return next(new Error('endDate must be later than startDate.'));
    }
  }
  if (this.leaseType === 'At-will' && !this.startDate) {
    return next(new Error('At-will draft requires a startDate.'));
  }
  next();
});

export const DraftLease: Model<IDraftLease> =
  (models.PmDraftLease as Model<IDraftLease>) ??
  model<IDraftLease>('PmDraftLease', DraftLeaseSchema);

export default DraftLease;
