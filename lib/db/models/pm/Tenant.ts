// Tenant (PDR §3.5). Phase 1 shipped the minimal directory shape. Phase 3
// adds `currentLeaseId` — the lease the tenant is currently living on. It's
// set by `leasingPromotion.executeDraftLease()` and refreshed by
// `lib/pm/leaseStatus.recomputeLeaseStatuses()`. Empty when the tenant is
// between leases or in the directory only.
// Phone shape mirrors RentalOwner: `{ number, smsOptIn }` per slot.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { StateOrProvince, TenantType } from '@/types/pm';
import { TENANT_TYPES } from '@/types/pm';

export interface ITenantPhone {
  number: string;
  smsOptIn: boolean;
}

export interface ITenantAddress {
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: StateOrProvince | '';
  zip?: string;
  country?: string;
}

export interface ITenant {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** changes.md §1 — Individual ⇒ first/last name required; Company ⇒
   *  companyName required. Defaults to Individual for back-compat. */
  tenantType: TenantType;
  /** Required for Individuals; left empty for Companies. */
  firstName: string;
  lastName: string;
  /** Company tenants only — the legal entity name shown everywhere. */
  companyName?: string;
  /** Company tenants only — the person to reach at the company. */
  contactPersonName?: string;
  email?: string;
  phones: {
    mobile?: ITenantPhone;
    home?: ITenantPhone;
    work?: ITenantPhone;
    fax?: ITenantPhone;
  };
  address: ITenantAddress;
  dateOfBirth?: Date | null;
  ssnLast4?: string;
  cosignerFlag: boolean;
  residentCenterAccess: boolean;
  /** Phase 3 — points at the Active lease the tenant lives on; null when
   *  between leases. Maintained by leasingPromotion + recomputeLeaseStatuses. */
  currentLeaseId?: Types.ObjectId | null;
  customFields: Map<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PhoneSchema = new Schema<ITenantPhone>(
  {
    number: { type: String, trim: true, default: '' },
    smsOptIn: { type: Boolean, default: false },
  },
  { _id: false },
);

const AddressSchema = new Schema<ITenantAddress>(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    line3: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zip: { type: String, trim: true },
    country: { type: String, trim: true, default: 'US' },
  },
  { _id: false },
);

const TenantSchema = new Schema<ITenant>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    tenantType: { type: String, enum: TENANT_TYPES, default: 'Individual' },
    // §1 — first/last are conditionally required via the pre('validate') hook
    // below (required for Individuals, optional for Companies), so the schema
    // itself keeps them optional to leave every existing individual doc valid.
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    companyName: { type: String, trim: true, maxlength: 200 },
    contactPersonName: { type: String, trim: true, maxlength: 160 },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    phones: {
      mobile: { type: PhoneSchema, default: undefined },
      home: { type: PhoneSchema, default: undefined },
      work: { type: PhoneSchema, default: undefined },
      fax: { type: PhoneSchema, default: undefined },
    },
    address: { type: AddressSchema, default: () => ({}) },
    dateOfBirth: { type: Date, default: null },
    ssnLast4: {
      type: String,
      trim: true,
      validate: {
        validator: (v?: string) => !v || /^\d{4}$/.test(v),
        message: 'ssnLast4 must be exactly 4 digits',
      },
    },
    cosignerFlag: { type: Boolean, default: false },
    residentCenterAccess: { type: Boolean, default: false },
    currentLeaseId: {
      type: Schema.Types.ObjectId,
      ref: 'PmLease',
      default: null,
    },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_tenants' },
);

TenantSchema.index({ organizationId: 1, active: 1, lastName: 1, firstName: 1 });
TenantSchema.index({ organizationId: 1, currentLeaseId: 1 });

// §1 — conditional-required validation. Individual tenants need first + last
// name; Company tenants need a company name. Mirrors the Zod `.superRefine`
// in lib/validation/pm/tenant.ts so API and direct model writes agree.
TenantSchema.pre('validate', function (next) {
  if (this.tenantType === 'Company') {
    if (!this.companyName || !this.companyName.trim()) {
      return next(new Error('Company tenants require a companyName.'));
    }
  } else {
    if (!this.firstName || !this.firstName.trim() ||
        !this.lastName || !this.lastName.trim()) {
      return next(new Error('Individual tenants require firstName and lastName.'));
    }
  }
  next();
});

export const Tenant: Model<ITenant> =
  (models.PmTenant as Model<ITenant>) ??
  model<ITenant>('PmTenant', TenantSchema);

export default Tenant;
