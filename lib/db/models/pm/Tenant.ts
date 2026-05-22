// Tenant (PDR §3.5). Phase 1 shipped the minimal directory shape. Phase 3
// adds `currentLeaseId` — the lease the tenant is currently living on. It's
// set by `leasingPromotion.executeDraftLease()` and refreshed by
// `lib/pm/leaseStatus.recomputeLeaseStatuses()`. Empty when the tenant is
// between leases or in the directory only.
// Phone shape mirrors RentalOwner: `{ number, smsOptIn }` per slot.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { UsState } from '@/types/pm';

export interface ITenantPhone {
  number: string;
  smsOptIn: boolean;
}

export interface ITenantAddress {
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: UsState | '';
  zip?: string;
  country?: string;
}

export interface ITenant {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  firstName: string;
  lastName: string;
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
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
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

export const Tenant: Model<ITenant> =
  (models.PmTenant as Model<ITenant>) ??
  model<ITenant>('PmTenant', TenantSchema);

export default Tenant;
