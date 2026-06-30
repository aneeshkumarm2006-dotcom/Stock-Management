// Lease — active lease record (PDR_MASTER §3.3). Lives in its own collection
// distinct from DraftLease so a unit can carry a Future lease and an Active
// lease at the same time (BR-LL-2). `leaseNumber` is a monotonic per-org
// integer assigned at insert.
//
// Status:
//   Active  → start ≤ today < end (or end null for At-will)
//   Future  → today < start
//   Expired → today > end and not yet rolled over
//   Ended   → manual termination
//   Cancelled → never executed (shouldn't happen — Drafts go Cancelled)
// Derived in the route on read; persisted for fast filtering on `(2) Active,
// Future` (BR-LL-2 default chip).
//
// `evictionPending` is an OVERLAY ATTRIBUTE, not a status (BR-LL-3). Renders
// a red banner without taking the lease out of "Active". Triggers are
// [G-B-9] deferred.
//
// Liability invariant (BR-LL-4):
//   currentDepositHeld = received − withheld − refunded
// All three fields are derived from the security-deposit journal trail; we
// store them as integer cents and recompute on each deposit/refund post.
// Phase 3 sets `securityDepositsHeld[received]` from the move-in charges
// flow; withheld/refunded land via Phase 9 reconciliation work.
//
// Memo cap (BR-PU-6) and inline-file cap (BR-PU-7) shared with DraftLease.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  EsignatureStatus,
  LeaseType,
  LeaseStatus,
  LeaseTermKind,
  RentCycle,
  RentMethod,
  TenantType,
} from '@/types/pm';
import {
  ESIGNATURE_STATUSES,
  LEASE_TYPES,
  LEASE_STATUSES,
  LEASE_TERM_KINDS,
  RENT_CYCLES,
  RENT_METHODS,
  TENANT_TYPES,
} from '@/types/pm';
import {
  LEASE_MEMO_MAX,
  LEASE_INLINE_FILE_CAP,
} from './DraftLease';

export interface ILeaseTenantRef {
  tenantId: Types.ObjectId;
  /** §1 — snapshot of the tenant's type so the ref renders without a join.
   *  Optional for back-compat: legacy refs (all Individuals) omit it. */
  tenantType?: TenantType;
  /** Required-shaped but stored empty for Company tenants (§1). */
  firstName: string;
  lastName: string;
  /** Set when the tenant is a Company; the rent roll falls back to this. */
  companyName?: string;
  email?: string;
  isCosigner: boolean;
}

export interface ILeaseSecurityDeposit {
  /** Total dollars received (cents). Maintained by Phase 2 ledger posts; the
   *  Lease route reads from JournalEntry rather than mutating this directly. */
  received: number;
  /** Withheld portion at move-out. */
  withheld: number;
  /** Refunded portion to former tenant. */
  refunded: number;
}

export interface ILeasePrimaryRent {
  amount: number; // cents — always the RESOLVED monthly rent (§3)
  accountId: Types.ObjectId;
  /** §3 — how `amount` was entered. `RatePerSqft` derives it from the rate
   *  below × the unit's sizeSqft at save time. Defaults to `Fixed`. */
  rentMethod: RentMethod;
  /** §3 — per-sqft rate in cents; 0 (or absent) for `Fixed`. Stored so the
   *  rate survives an edit round-trip without re-deriving from `amount`. */
  ratePerSqftCents?: number;
  nextDueDate?: Date | null;
  memo?: string;
}

export interface ILeaseSplitRentCharge {
  accountId: Types.ObjectId;
  amount: number; // cents
  memo?: string;
}

/**
 * ILeaseTermPeriod — ONE dated row of a commercial lease's rent-escalation
 * schedule (the client's "Lease Summary": Year 1‑2, Year 3‑5, … plus a
 * Renewal Option). Inputs only — every dollar figure is DERIVED from the
 * per‑sqft rates × `sizeSqft`, so the row never drifts from its own snapshot.
 *
 * CONVENTION: rates are ANNUAL DOLLARS per square foot (e.g. 16.5, 17.875).
 * They are rates/multipliers, not ledger amounts, so they are stored as plain
 * numbers (a rate can carry a fractional cent like $17.875/sf) — only the
 * RESOLVED amounts are integer cents:
 *   annual cents  = round(rate × sizeSqft × 100)
 *   monthly cents = round(annual / 12)
 * This is the commercial $/sf/YEAR convention used by the sheet and is
 * INDEPENDENT of the legacy `primaryRent.rentMethod='RatePerSqft'` (which
 * treats its rate as a monthly cents rate). See `lib/pm/rentSchedule.ts` for
 * the single computation source.
 *
 * `kind='RenewalOption'` rows are recorded for reference and NEVER post to the
 * ledger. Only the active `kind='Term'` row drives GL rent posting by date.
 */
export interface ILeaseTermPeriod {
  /** Human label shown on the schedule, e.g. "Year 1-2", "Renewal Option". */
  label: string;
  kind: LeaseTermKind;
  startDate: Date;
  endDate: Date;
  /** Square footage SNAPSHOT at save time — the Unit's `sizeSqft` may change
   *  later, but a recorded period must reproduce its own figures forever. */
  sizeSqft: number;
  /** Annual dollars per sq ft. 0 means the component is absent. */
  baseRatePerSqft: number;
  baseAccountId?: Types.ObjectId | null;
  opexRatePerSqft: number;
  opexAccountId?: Types.ObjectId | null;
  taxRatePerSqft: number;
  taxAccountId?: Types.ObjectId | null;
}

export interface ILeaseRecurringCharge {
  amount: number; // cents
  accountId: Types.ObjectId;
  frequency: RentCycle;
  nextDate?: Date | null;
  memo?: string;
  postNDaysInAdvance: number;
}

export interface ILeaseOneTimeCharge {
  amount: number; // cents
  accountId: Types.ObjectId;
  dueDate?: Date | null;
  memo?: string;
  posted: boolean;
  postedAt?: Date | null;
}

export interface ILeaseLateFeePolicy {
  enabled: boolean;
  feeAmount?: number;
  feePctOfRent?: number;
  daysAfterDue?: number;
  capAmount?: number;
}

export interface ILeaseEsigDocument {
  fileId?: Types.ObjectId | null;
  role: 'Lease' | 'Addendum';
  label: string;
  status: EsignatureStatus;
  sentAt?: Date | null;
  signedAt?: Date | null;
}

export interface ILease {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  leaseNumber: number;
  propertyId: Types.ObjectId;
  unitId: Types.ObjectId;
  rentalOwnerId?: Types.ObjectId | null;
  tenants: ILeaseTenantRef[];
  cosigners: ILeaseTenantRef[];
  leaseType: LeaseType;
  startDate: Date;
  /** Required for Fixed / Fixed w/rollover; nullable for At-will (BR-LL-1). */
  endDate?: Date | null;
  status: LeaseStatus;
  /** Overlay attribute — does NOT replace `status` (BR-LL-3). */
  evictionPending: boolean;
  evictionPendingNote?: string;
  rentCycle: RentCycle;
  primaryRent: ILeasePrimaryRent;
  splitRentCharges: ILeaseSplitRentCharge[];
  /** Commercial rent-escalation schedule (the "Lease Summary"). When present
   *  and a Term period is active, it DRIVES GL rent posting; `primaryRent`/
   *  `splitRentCharges` are kept in sync as the resolved CURRENT period so
   *  every legacy reader keeps working. Empty for ordinary single-rent leases. */
  rentSchedule: ILeaseTermPeriod[];
  /** Tenant's proportionate share of the building (%). Display/summary only —
   *  does NOT affect posted GL amounts. */
  proportionateSharePct?: number;
  /** Combined sales-tax rate for the "Total With GST/QST" summary line (e.g.
   *  14.975). Display/summary only — NOT posted to the ledger. */
  salesTaxRatePct?: number;
  securityDeposit: ILeaseSecurityDeposit;
  recurringCharges: ILeaseRecurringCharge[];
  oneTimeCharges: ILeaseOneTimeCharge[];
  lateFeePolicy: ILeaseLateFeePolicy;
  residentCenterWelcomeEmail: boolean;
  esignatureDocuments: ILeaseEsigDocument[];
  comments?: string;
  files: Types.ObjectId[];
  /** Back-pointer to the DraftLease the active record promoted from. */
  promotedFromDraftLeaseId?: Types.ObjectId | null;
  customFields: Map<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const TenantRefSchema = new Schema<ILeaseTenantRef>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'PmTenant',
      required: true,
    },
    tenantType: { type: String, enum: TENANT_TYPES, default: 'Individual' },
    // §1 — first/last relaxed to optional so Company tenant refs (which carry
    // companyName instead) validate. Existing individual refs keep their names.
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    companyName: { type: String, trim: true, maxlength: 200 },
    email: { type: String, trim: true, lowercase: true },
    isCosigner: { type: Boolean, default: false },
  },
  { _id: false },
);

const SplitRentSchema = new Schema<ILeaseSplitRentCharge>(
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

const TermPeriodSchema = new Schema<ILeaseTermPeriod>(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: LEASE_TERM_KINDS, default: 'Term' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    sizeSqft: { type: Number, default: 0, min: 0 },
    baseRatePerSqft: { type: Number, default: 0, min: 0 },
    baseAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      default: null,
    },
    opexRatePerSqft: { type: Number, default: 0, min: 0 },
    opexAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      default: null,
    },
    taxRatePerSqft: { type: Number, default: 0, min: 0 },
    taxAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      default: null,
    },
  },
  { _id: true },
);

const PrimaryRentSchema = new Schema<ILeasePrimaryRent>(
  {
    amount: { type: Number, required: true, min: 0 },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    rentMethod: { type: String, enum: RENT_METHODS, default: 'Fixed' },
    ratePerSqftCents: { type: Number, min: 0, default: 0 },
    nextDueDate: { type: Date, default: null },
    memo: { type: String, trim: true, maxlength: LEASE_MEMO_MAX },
  },
  { _id: false },
);

const SecurityDepositSchema = new Schema<ILeaseSecurityDeposit>(
  {
    received: { type: Number, default: 0, min: 0 },
    withheld: { type: Number, default: 0, min: 0 },
    refunded: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const RecurringChargeSchema = new Schema<ILeaseRecurringCharge>(
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
  { _id: true },
);

const OneTimeChargeSchema = new Schema<ILeaseOneTimeCharge>(
  {
    amount: { type: Number, required: true, min: 0 },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    dueDate: { type: Date, default: null },
    memo: { type: String, trim: true, maxlength: LEASE_MEMO_MAX },
    posted: { type: Boolean, default: false },
    postedAt: { type: Date, default: null },
  },
  { _id: true },
);

const LateFeeSchema = new Schema<ILeaseLateFeePolicy>(
  {
    enabled: { type: Boolean, default: false },
    feeAmount: { type: Number, default: 0, min: 0 },
    feePctOfRent: { type: Number, default: 0, min: 0, max: 100 },
    daysAfterDue: { type: Number, default: 5, min: 0 },
    capAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const EsigDocSchema = new Schema<ILeaseEsigDocument>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'PmFile', default: null },
    role: { type: String, enum: ['Lease', 'Addendum'], default: 'Lease' },
    label: { type: String, required: true, trim: true, maxlength: 200 },
    status: {
      type: String,
      enum: ESIGNATURE_STATUSES,
      default: 'Completed',
    },
    sentAt: { type: Date, default: null },
    signedAt: { type: Date, default: null },
  },
  { _id: true },
);

const LeaseSchema = new Schema<ILease>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    leaseNumber: { type: Number, required: true },
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
    rentalOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'PmRentalOwner',
      default: null,
    },
    tenants: { type: [TenantRefSchema], default: () => [] },
    cosigners: { type: [TenantRefSchema], default: () => [] },
    leaseType: { type: String, enum: LEASE_TYPES, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    status: {
      type: String,
      enum: LEASE_STATUSES,
      default: 'Active',
    },
    evictionPending: { type: Boolean, default: false },
    evictionPendingNote: { type: String, maxlength: 2000 },
    rentCycle: { type: String, enum: RENT_CYCLES, default: 'Monthly' },
    primaryRent: { type: PrimaryRentSchema, required: true },
    splitRentCharges: { type: [SplitRentSchema], default: () => [] },
    rentSchedule: { type: [TermPeriodSchema], default: () => [] },
    proportionateSharePct: { type: Number, min: 0, max: 100, default: undefined },
    salesTaxRatePct: { type: Number, min: 0, max: 100, default: undefined },
    securityDeposit: {
      type: SecurityDepositSchema,
      default: () => ({ received: 0, withheld: 0, refunded: 0 }),
    },
    recurringCharges: { type: [RecurringChargeSchema], default: () => [] },
    oneTimeCharges: { type: [OneTimeChargeSchema], default: () => [] },
    lateFeePolicy: { type: LateFeeSchema, default: () => ({ enabled: false }) },
    residentCenterWelcomeEmail: { type: Boolean, default: false },
    esignatureDocuments: { type: [EsigDocSchema], default: () => [] },
    comments: { type: String, maxlength: 4000 },
    files: {
      type: [{ type: Schema.Types.ObjectId, ref: 'PmFile' }],
      default: [],
      validate: {
        validator: (v: unknown[]) => v.length <= LEASE_INLINE_FILE_CAP,
        message: `Lease inline file uploads cap at ${LEASE_INLINE_FILE_CAP} (BR-PU-7).`,
      },
    },
    promotedFromDraftLeaseId: {
      type: Schema.Types.ObjectId,
      ref: 'PmDraftLease',
      default: null,
    },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
  },
  { timestamps: true, collection: 'pm_leases' },
);

LeaseSchema.index(
  { organizationId: 1, leaseNumber: 1 },
  { unique: true },
);
LeaseSchema.index({ organizationId: 1, propertyId: 1, unitId: 1 });
LeaseSchema.index({ organizationId: 1, status: 1, startDate: -1 });
LeaseSchema.index({ organizationId: 1, endDate: 1 });
LeaseSchema.index({ organizationId: 1, evictionPending: 1, status: 1 });

// BR-LL-1 — Fixed-term leases must have endDate; At-will leases may not.
// BR-LL-3 — `evictionPending` is independent of status.
LeaseSchema.pre('validate', function (next) {
  if ((this.leaseType === 'Fixed' || this.leaseType === 'Fixed w/rollover') &&
      !this.endDate) {
    return next(new Error('Fixed-term leases require an endDate (BR-LL-1).'));
  }
  if (this.endDate && this.startDate && this.endDate <= this.startDate) {
    return next(new Error('endDate must be later than startDate.'));
  }
  next();
});

/** Derives status from dates. Routes call this on read so a date-driven
 *  status flip happens without a cron job. */
export function deriveLeaseStatus(lease: Pick<ILease, 'status' | 'startDate' | 'endDate' | 'leaseType'>): LeaseStatus {
  if (lease.status === 'Ended' || lease.status === 'Cancelled') return lease.status;
  const now = Date.now();
  const start = lease.startDate ? lease.startDate.getTime() : null;
  const end = lease.endDate ? lease.endDate.getTime() : null;
  if (start !== null && now < start) return 'Future';
  if (end !== null && now > end) return 'Expired';
  return 'Active';
}

/** Days remaining for the `Days remaining` orange chip (BR-LL-5).
 *  Returns null for At-will or when endDate is in the past. */
export function daysRemainingForChip(lease: Pick<ILease, 'endDate' | 'leaseType'>): number | null {
  if (lease.leaseType === 'At-will' || !lease.endDate) return null;
  const ms = lease.endDate.getTime() - Date.now();
  if (ms < 0) return null;
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days <= 90 ? days : null;
}

/** BR-LL-4 — Current = Received − Withheld − Refunded. */
export function currentDepositHeld(d: ILeaseSecurityDeposit): number {
  return Math.max(0, (d.received ?? 0) - (d.withheld ?? 0) - (d.refunded ?? 0));
}

export const Lease: Model<ILease> =
  (models.PmLease as Model<ILease>) ?? model<ILease>('PmLease', LeaseSchema);

export default Lease;
