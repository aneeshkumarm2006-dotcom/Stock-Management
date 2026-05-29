// Property — the system-of-record for every physical asset (PDR §3.1).
// Heavily FK-referenced by downstream phases (Lease, WorkOrder, Bill,
// CalendarEvent, …). Carries the RentalOwner junction inline:
// `rentalOwners[] = [{ rentalOwnerId, ownershipPct }]` with BR-PU-1 validated
// pre-save (sum must equal 100 when any owners attached).
// `propertySubType` is gated by `propertyClass` per DECISIONS.md [G-S-24].
// Soft-archive via `active=false` (BR-PU-2); reactivation [G-B-2].
// Derived fields (cashBalance, securityDepositsHeld, availableCash) are
// computed by the route on read — Phase 1 returns zeros for the upstream
// roll-ups; Phase 2/3 fill them in once JE + Lease land.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  PropertyClass,
  PropertySubType,
  ResidentialSubType,
  CommercialSubType,
  StateOrProvince,
  ManagementFeeBillingFrequency,
} from '@/types/pm';
import {
  COMMERCIAL_SUBTYPES,
  MANAGEMENT_FEE_BILLING_FREQUENCIES,
  RESIDENTIAL_SUBTYPES,
} from '@/types/pm';
import { WarningSchema, type IWarning } from './_shared/WarningSchema';

export const PROPERTY_CLASSES: PropertyClass[] = ['Residential', 'Commercial'];

export const RESIDENT_CENTER_PAYMENT_HISTORY = [
  'Hidden',
  'Tenant can view current lease only',
  'Tenant can view all transactions',
] as const;

export interface IPropertyAddress {
  line1: string;
  line2?: string;
  line3?: string;
  city: string;
  state: StateOrProvince | '';
  zip: string;
  country: string;
}

export interface IPropertyOwnerJunction {
  rentalOwnerId: Types.ObjectId;
  ownershipPct: number;
}

export interface IPropertyResidentCenterRequests {
  enabled: boolean;
  showEntryQuestions: boolean;
}

/** Per-property management-fee agreement (PDR §3.27, BR-AC-16).
 *  DECISIONS.md [G-S-38] resolves the location as an embedded subdoc on
 *  Property — a full ManagementFeeAgreement entity with historical
 *  versioning is deferred until a dedicated fee module ships.
 *  Exactly one of `feePercent` or `feeFlatCents` must be set when the
 *  agreement is active. `lastCollectedDate` makes
 *  `collectManagementFees` idempotent per Property × period. */
export interface IPropertyManagementFeeAgreement {
  active: boolean;
  feePercent?: number | null;
  feeFlatCents?: number | null;
  billingFrequency: ManagementFeeBillingFrequency;
  startDate?: Date | null;
  endDate?: Date | null;
  lastCollectedDate?: Date | null;
}

export interface IProperty {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  propertyName: string;
  /** Presence is optional (surfaces as MISSING_PROPERTY_NAME warning). */
  propertyClass: PropertyClass;
  /** Free string at the storage level — subtype/class mismatch surfaces as
   *  SUBTYPE_CLASS_MISMATCH warning rather than a hard validator. */
  propertySubType: PropertySubType | '';
  address: IPropertyAddress;
  photo?: Types.ObjectId | null;
  /** Image gallery — refs to PmFile rows. `photo` is the cover image (auto-set
   *  to images[0] when none is chosen explicitly). */
  images: Types.ObjectId[];
  propertyManagerUserId?: Types.ObjectId | null;
  rentalOwners: IPropertyOwnerJunction[];
  operatingAccountId?: Types.ObjectId | null;
  depositTrustAccountId?: Types.ObjectId | null;
  propertyReserve: number;
  listingDescription?: string;
  amenities: string[];
  includedInRent: string[];
  residentCenterPaymentHistory?: string;
  residentCenterRequests: IPropertyResidentCenterRequests;
  residentCenterForums: boolean;
  rentersInsuranceMinLiability3rdParty?: number | null;
  rentersInsuranceMinLiabilityMSI?: number | null;
  managementFeeAgreement?: IPropertyManagementFeeAgreement | null;
  customFields: Map<string, unknown>;
  active: boolean;
  warnings: IWarning[];
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IPropertyAddress>(
  {
    line1: { type: String, default: '', trim: true },
    line2: { type: String, trim: true },
    line3: { type: String, trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    zip: { type: String, default: '', trim: true },
    country: { type: String, default: 'US', trim: true },
  },
  { _id: false },
);

const OwnerJunctionSchema = new Schema<IPropertyOwnerJunction>(
  {
    rentalOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'PmRentalOwner',
      default: null,
    },
    ownershipPct: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false },
);

const ResidentRequestsSchema = new Schema<IPropertyResidentCenterRequests>(
  {
    enabled: { type: Boolean, default: false },
    showEntryQuestions: { type: Boolean, default: false },
  },
  { _id: false },
);

const ManagementFeeAgreementSchema = new Schema<IPropertyManagementFeeAgreement>(
  {
    active: { type: Boolean, default: false },
    feePercent: { type: Number, default: null, min: 0, max: 100 },
    feeFlatCents: { type: Number, default: null, min: 0 },
    billingFrequency: {
      type: String,
      enum: MANAGEMENT_FEE_BILLING_FREQUENCIES,
      required: true,
      default: 'Monthly',
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    lastCollectedDate: { type: Date, default: null },
  },
  { _id: false },
);

const PropertySchema = new Schema<IProperty>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    propertyName: { type: String, default: '', trim: true, maxlength: 200 },
    // propertyClass keeps its enum constraint (type check) but no longer requires presence.
    propertyClass: { type: String, enum: PROPERTY_CLASSES, default: 'Residential' },
    propertySubType: { type: String, default: '', trim: true },
    address: { type: AddressSchema, default: () => ({}) },
    photo: { type: Schema.Types.ObjectId, ref: 'PmFile', default: null },
    images: {
      type: [{ type: Schema.Types.ObjectId, ref: 'PmFile' }],
      default: [],
    },
    propertyManagerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    rentalOwners: { type: [OwnerJunctionSchema], default: [] },
    operatingAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBankAccount',
      default: null,
    },
    depositTrustAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBankAccount',
      default: null,
    },
    propertyReserve: { type: Number, default: 0, min: 0 },
    listingDescription: { type: String, maxlength: 8000 },
    amenities: { type: [String], default: [] },
    includedInRent: { type: [String], default: [] },
    residentCenterPaymentHistory: {
      type: String,
      enum: RESIDENT_CENTER_PAYMENT_HISTORY,
      default: 'Hidden',
    },
    residentCenterRequests: {
      type: ResidentRequestsSchema,
      default: () => ({ enabled: false, showEntryQuestions: false }),
    },
    residentCenterForums: { type: Boolean, default: false },
    rentersInsuranceMinLiability3rdParty: { type: Number, default: null, min: 0 },
    rentersInsuranceMinLiabilityMSI: { type: Number, default: null, min: 0 },
    managementFeeAgreement: {
      type: ManagementFeeAgreementSchema,
      default: null,
    },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    active: { type: Boolean, default: true },
    warnings: { type: [WarningSchema], default: [] },
  },
  { timestamps: true, collection: 'pm_properties' },
);

PropertySchema.index({ organizationId: 1, active: 1, propertyName: 1 });
PropertySchema.index({ organizationId: 1, 'rentalOwners.rentalOwnerId': 1 });

// NOTE: The previous pre('save') hook enforcing ownership-sum=100%,
// subtype-class gating, and management-fee-agreement XOR has been removed.
// Those business rules now live in `computeWarnings()` (see lib/pm/warnings.ts)
// and surface as non-blocking amber warnings on the created entity.
// Downstream jobs (distributions, 1099s, fee posters) should call
// `hasBlockingWarnings(doc.warnings, [...])` before posting.

// Re-export the gated enum arrays so the form layer can render the right
// dropdown when the user toggles class.
export const PROPERTY_SUBTYPES_BY_CLASS: Record<
  PropertyClass,
  readonly (ResidentialSubType | CommercialSubType)[]
> = {
  Residential: RESIDENTIAL_SUBTYPES,
  Commercial: COMMERCIAL_SUBTYPES,
};

export const Property: Model<IProperty> =
  (models.PmProperty as Model<IProperty>) ??
  model<IProperty>('PmProperty', PropertySchema);

export default Property;
