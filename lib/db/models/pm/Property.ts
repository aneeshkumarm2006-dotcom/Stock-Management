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
  PmCurrency,
} from '@/types/pm';
import {
  COMMERCIAL_SUBTYPES,
  MANAGEMENT_FEE_BILLING_FREQUENCIES,
  PM_CURRENCIES,
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
  /**
   * Native currency of every money amount booked against this property —
   * leases, bills, GL lines, deposits. The PM analogue of `Position.currency`
   * on the stock side.
   *
   * OPTIONAL BY DESIGN. `undefined` means "inherit Organization.defaultCurrency",
   * which is exactly how the ledger behaved before this field existed, so
   * existing data renders unchanged until someone sets it deliberately.
   * `scripts/backfill-property-currency.ts` proposes a value from
   * `address.country` (CA → CAD, US → USD) and only writes with `--apply`.
   * Resolve via `resolvePropertyCurrency()` in lib/pm/currency.ts — never read
   * this field raw, or you lose the org fallback.
   */
  currency?: PmCurrency | null;
  photo?: Types.ObjectId | null;
  /** Image gallery — refs to PmFile rows. `photo` is the cover image (auto-set
   *  to images[0] when none is chosen explicitly). */
  images: Types.ObjectId[];
  propertyManagerUserId?: Types.ObjectId | null;
  /**
   * The legal entity (CompanyAccount) that owns this building.
   *
   * Distinct from `rentalOwners[]`: those are the people/entities that hold an
   * ownership PERCENTAGE and receive distributions, whereas this is the single
   * parent company whose books the property rolls up into. It is what makes
   * "all properties for each company" answerable — company-wide costs
   * (mortgage, blanket insurance) are scoped to the company, and an insurance
   * line can be split across exactly this set.
   *
   * `null` means unassigned; the property simply never participates in a
   * company-level split. Never inferred from the property name.
   */
  companyAccountId?: Types.ObjectId | null;
  rentalOwners: IPropertyOwnerJunction[];
  operatingAccountId?: Types.ObjectId | null;
  depositTrustAccountId?: Types.ObjectId | null;
  propertyReserve: number;
  // Income-capitalization valuation inputs. Market value is DERIVED — never
  // stored — as (annualIncome − annualExpense) / (capRatePct / 100). The two
  // money overrides are in DOLLARS (matching propertyReserve, NOT ledger
  // cents); `null` means "use the live General Ledger figure" for that input.
  // `valuationCapRatePct` is a plain percentage (e.g. 6.5 = 6.5%).
  valuationAnnualIncomeOverride?: number | null;
  valuationAnnualExpenseOverride?: number | null;
  valuationCapRatePct?: number | null;
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
    // No `default:` on purpose — an unset value means "inherit the org
    // currency", which preserves pre-existing ledger behaviour exactly.
    currency: { type: String, enum: [...PM_CURRENCIES], default: undefined },
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
    companyAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmCompanyAccount',
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
    // Valuation overrides (dollars) + cap rate (percent). Default null so the
    // detail card falls back to the live GL income/expense until a value is set.
    valuationAnnualIncomeOverride: { type: Number, default: null, min: 0 },
    valuationAnnualExpenseOverride: { type: Number, default: null, min: 0 },
    valuationCapRatePct: { type: Number, default: null, min: 0, max: 100 },
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
// "Every active property belonging to company X" — the allocation lookup, run
// once per company per recurring period.
PropertySchema.index({ organizationId: 1, companyAccountId: 1, active: 1 });

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
