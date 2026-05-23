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
  UsState,
  ManagementFeeBillingFrequency,
} from '@/types/pm';
import {
  COMMERCIAL_SUBTYPES,
  MANAGEMENT_FEE_BILLING_FREQUENCIES,
  RESIDENTIAL_SUBTYPES,
} from '@/types/pm';

const RES_SUBTYPES = new Set<string>(RESIDENTIAL_SUBTYPES);
const COM_SUBTYPES = new Set<string>(COMMERCIAL_SUBTYPES);

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
  state: UsState | '';
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
  propertyClass: PropertyClass;
  propertySubType: PropertySubType;
  address: IPropertyAddress;
  photo?: Types.ObjectId | null;
  propertyManagerUserId?: Types.ObjectId | null;
  rentalOwners: IPropertyOwnerJunction[];
  operatingAccountId: Types.ObjectId;
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
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IPropertyAddress>(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    line3: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    zip: { type: String, required: true, trim: true },
    country: { type: String, default: 'US', trim: true },
  },
  { _id: false },
);

const OwnerJunctionSchema = new Schema<IPropertyOwnerJunction>(
  {
    rentalOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'PmRentalOwner',
      required: true,
    },
    ownershipPct: { type: Number, required: true, min: 0, max: 100 },
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
    propertyName: { type: String, required: true, trim: true, maxlength: 200 },
    propertyClass: { type: String, enum: PROPERTY_CLASSES, required: true },
    propertySubType: { type: String, required: true, trim: true },
    address: { type: AddressSchema, required: true },
    photo: { type: Schema.Types.ObjectId, ref: 'PmFile', default: null },
    propertyManagerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    rentalOwners: { type: [OwnerJunctionSchema], default: [] },
    operatingAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmBankAccount',
      required: true,
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
  },
  { timestamps: true, collection: 'pm_properties' },
);

PropertySchema.index({ organizationId: 1, active: 1, propertyName: 1 });
PropertySchema.index({ organizationId: 1, 'rentalOwners.rentalOwnerId': 1 });

// BR-PU-1 + DECISIONS.md [G-S-24] — gating validators.
PropertySchema.pre('save', function (next) {
  // 1. Ownership percentages must sum to 100 when any owners are attached.
  if (this.rentalOwners && this.rentalOwners.length > 0) {
    const sum = this.rentalOwners.reduce(
      (acc, r) => acc + (Number.isFinite(r.ownershipPct) ? r.ownershipPct : 0),
      0,
    );
    if (Math.abs(sum - 100) > 0.01) {
      return next(
        new Error(
          `Rental-owner ownershipPct must sum to 100%; currently ${sum}%`,
        ),
      );
    }
    // Disallow duplicate owner refs.
    const seen = new Set<string>();
    for (const j of this.rentalOwners) {
      const k = String(j.rentalOwnerId);
      if (seen.has(k)) {
        return next(new Error('Duplicate rental owner attached to property'));
      }
      seen.add(k);
    }
  }

  // 2. propertySubType must be in the right subset for the chosen class.
  const subType = this.propertySubType as string;
  if (this.propertyClass === 'Residential' && !RES_SUBTYPES.has(subType)) {
    return next(
      new Error(
        `propertySubType "${subType}" is not valid for Residential properties`,
      ),
    );
  }
  if (this.propertyClass === 'Commercial' && !COM_SUBTYPES.has(subType)) {
    return next(
      new Error(
        `propertySubType "${subType}" is not valid for Commercial properties`,
      ),
    );
  }

  // 3. ManagementFeeAgreement (BR-AC-16, [G-S-38]) — exactly one of
  //    feePercent / feeFlatCents must be set when active.
  const mfa = this.managementFeeAgreement;
  if (mfa && mfa.active) {
    const hasPct = mfa.feePercent != null && mfa.feePercent > 0;
    const hasFlat = mfa.feeFlatCents != null && mfa.feeFlatCents > 0;
    if (hasPct === hasFlat) {
      return next(
        new Error(
          'Active managementFeeAgreement requires exactly one of feePercent or feeFlatCents.',
        ),
      );
    }
    if (mfa.endDate && mfa.startDate && mfa.endDate < mfa.startDate) {
      return next(
        new Error('managementFeeAgreement.endDate must be on or after startDate.'),
      );
    }
  }

  next();
});

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
