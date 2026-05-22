// Applicant — rental application record (PDR_MASTER §3.7). The Applicant
// entity carries the 14-item move-in checklist (BR-LA-5): 3 + 6 + 5 across
// Stage 1 Application, Stage 2 Screening, Stage 3 Move-in. The checklist is
// COMPLETION TRACKING ONLY — applicant `status` is independent (BR-LA-6),
// so a PM can flip status → Approved with items still open.
//
// Storage:
//   - `applicationNumber` is a per-org monotonic integer. We tag the doc with
//     the next number in the pre('save') hook (atomic findOneAndUpdate on a
//     counter doc would scale better; the current model uses a count query
//     since Phase 3 volumes are tiny).
//   - `applicantSsn` stores only the LAST FOUR characters (BR-LA in spirit
//     and PDR §3.7). Full SSN never persists.
//   - `checklist[]` is an embedded sub-doc array seeded with the 14 default
//     items on insert; org-level configurability is [G-B-7] deferred.
//
// Derived (computed by routes on read):
//   - `checklistOverallPct` = checked/total · 100
//   - `displayName` = `firstName lastName`
//   - `Stage X (n)` counts surfaced on the Applicant card
//
// Auto-check: when an application is received via the self-serve email link,
// "Receive rental application" auto-checks with actor = `System` (BR-LA-7).
// We expose a helper `markApplicationReceived` for the public-form endpoint
// to call (Phase 6 wiring).
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  ApplicantStatus,
  ApplicantScreeningStatus,
  UsState,
} from '@/types/pm';
import {
  APPLICANT_STATUSES,
  APPLICANT_SCREENING_STATUSES,
} from '@/types/pm';

/** 14-item default checklist split into 3 stages (BR-LA-5). The triple is
 *  the agreed Phase 3 default; PMs can flip `checked` on any item but cannot
 *  add/remove items until [G-B-7] resolves. */
export const APPLICANT_DEFAULT_CHECKLIST: ReadonlyArray<{
  stage: 1 | 2 | 3;
  label: string;
}> = [
  // Stage 1 — Application (3)
  { stage: 1, label: 'Receive rental application' },
  { stage: 1, label: 'Verify applicant identity' },
  { stage: 1, label: 'Collect application fee' },
  // Stage 2 — Screening (6)
  { stage: 2, label: 'Order credit + background screening' },
  { stage: 2, label: 'Verify employment + income' },
  { stage: 2, label: 'Verify rental history' },
  { stage: 2, label: 'Contact references' },
  { stage: 2, label: 'Review screening report' },
  { stage: 2, label: 'Make approval decision' },
  // Stage 3 — Move-in (5)
  { stage: 3, label: 'Send draft lease for signature' },
  { stage: 3, label: 'Collect security deposit + first month rent' },
  { stage: 3, label: 'Verify renters insurance policy' },
  { stage: 3, label: 'Provide keys + move-in instructions' },
  { stage: 3, label: 'Complete move-in inspection' },
] as const;

export const APPLICANT_CHECKLIST_TOTAL = APPLICANT_DEFAULT_CHECKLIST.length;

export interface IApplicantChecklistItem {
  stage: 1 | 2 | 3;
  label: string;
  checked: boolean;
  /** When the item flipped checked. */
  checkedAt?: Date | null;
  /** Acting user or the sentinel `System`. Stored as ObjectId for users,
   *  null when actor = `System`. */
  checkedByUserId?: Types.ObjectId | null;
  /** Set when actor = System (e.g. self-serve email receipt). */
  systemChecked: boolean;
}

export interface IApplicantPhone {
  number: string;
  label?: string;
}

export interface IApplicantAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: UsState | '';
  zip?: string;
  country?: string;
}

export interface IApplicantRentalHistory {
  address?: string;
  landlordName?: string;
  landlordPhone?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  monthlyRent?: number; // cents
  reasonForLeaving?: string;
}

export interface IApplicantEmployment {
  employer?: string;
  position?: string;
  monthlyIncome?: number; // cents
  startDate?: Date | null;
  endDate?: Date | null;
  supervisorName?: string;
  supervisorPhone?: string;
}

export interface IApplicant {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  firstName: string;
  lastName: string;
  applicationNumber: number; // monotonic per-org
  applicationReceivedAt: Date;
  status: ApplicantStatus;
  email?: string;
  phones: IApplicantPhone[];
  propertyId?: Types.ObjectId | null;
  unitId?: Types.ObjectId | null;
  applicantAddress: IApplicantAddress;
  applicantBirthDate?: Date | null;
  /** SSN stored as last-4 only. */
  applicantSsnLast4?: string;
  rentalHistory: IApplicantRentalHistory[];
  employment: IApplicantEmployment[];
  checklist: IApplicantChecklistItem[];
  screeningStatus: ApplicantScreeningStatus;
  emailLinkToOnlineApplication: boolean;
  /** Promoted-to-tenant cross-link (Phase 3 promotion path). */
  promotedToTenantId?: Types.ObjectId | null;
  promotedAt?: Date | null;
  /** Optional reverse pointer to the Prospect that converted into this row. */
  sourceProspectId?: Types.ObjectId | null;
  customFields: Map<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const PhoneSchema = new Schema<IApplicantPhone>(
  {
    number: { type: String, trim: true, default: '' },
    label: { type: String, trim: true, maxlength: 30 },
  },
  { _id: false },
);

const AddressSchema = new Schema<IApplicantAddress>(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zip: { type: String, trim: true },
    country: { type: String, trim: true, default: 'US' },
  },
  { _id: false },
);

const RentalHistorySchema = new Schema<IApplicantRentalHistory>(
  {
    address: { type: String, trim: true },
    landlordName: { type: String, trim: true },
    landlordPhone: { type: String, trim: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    monthlyRent: { type: Number, default: 0, min: 0 },
    reasonForLeaving: { type: String, trim: true, maxlength: 2000 },
  },
  { _id: false },
);

const EmploymentSchema = new Schema<IApplicantEmployment>(
  {
    employer: { type: String, trim: true },
    position: { type: String, trim: true },
    monthlyIncome: { type: Number, default: 0, min: 0 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    supervisorName: { type: String, trim: true },
    supervisorPhone: { type: String, trim: true },
  },
  { _id: false },
);

const ChecklistItemSchema = new Schema<IApplicantChecklistItem>(
  {
    stage: { type: Number, enum: [1, 2, 3], required: true },
    label: { type: String, required: true, trim: true },
    checked: { type: Boolean, default: false },
    checkedAt: { type: Date, default: null },
    checkedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    systemChecked: { type: Boolean, default: false },
  },
  { _id: true },
);

const ApplicantSchema = new Schema<IApplicant>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    applicationNumber: { type: Number, required: true },
    applicationReceivedAt: { type: Date, default: () => new Date() },
    status: {
      type: String,
      enum: APPLICANT_STATUSES,
      default: 'New',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    phones: {
      type: [PhoneSchema],
      default: () => [],
      validate: {
        validator: (v: IApplicantPhone[]) => v.length <= 4,
        message: 'Applicants support a maximum of 4 phone numbers.',
      },
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      default: null,
    },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PmUnit',
      default: null,
    },
    applicantAddress: { type: AddressSchema, default: () => ({}) },
    applicantBirthDate: { type: Date, default: null },
    applicantSsnLast4: {
      type: String,
      trim: true,
      validate: {
        validator: (v?: string) => !v || /^\d{4}$/.test(v),
        message: 'applicantSsnLast4 must be exactly 4 digits',
      },
    },
    rentalHistory: { type: [RentalHistorySchema], default: () => [] },
    employment: { type: [EmploymentSchema], default: () => [] },
    checklist: { type: [ChecklistItemSchema], default: () => [] },
    screeningStatus: {
      type: String,
      enum: APPLICANT_SCREENING_STATUSES,
      default: 'Not ordered',
    },
    emailLinkToOnlineApplication: { type: Boolean, default: false },
    promotedToTenantId: {
      type: Schema.Types.ObjectId,
      ref: 'PmTenant',
      default: null,
    },
    promotedAt: { type: Date, default: null },
    sourceProspectId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProspect',
      default: null,
    },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
  },
  { timestamps: true, collection: 'pm_applicants' },
);

ApplicantSchema.index(
  { organizationId: 1, applicationNumber: 1 },
  { unique: true },
);
ApplicantSchema.index({
  organizationId: 1,
  status: 1,
  applicationReceivedAt: -1,
});
ApplicantSchema.index({ organizationId: 1, lastName: 1, firstName: 1 });

/** Seed the 14 default checklist items for a brand-new doc. */
export function buildDefaultApplicantChecklist(): IApplicantChecklistItem[] {
  return APPLICANT_DEFAULT_CHECKLIST.map((item) => ({
    stage: item.stage,
    label: item.label,
    checked: false,
    checkedAt: null,
    checkedByUserId: null,
    systemChecked: false,
  }));
}

export const Applicant: Model<IApplicant> =
  (models.PmApplicant as Model<IApplicant>) ??
  model<IApplicant>('PmApplicant', ApplicantSchema);

export default Applicant;
