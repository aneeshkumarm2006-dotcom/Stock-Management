// Vendor — supplier of work-orders + recipient of bills (PDR_MASTER §3.11).
// Soft-archive via `active` flag (BR-MV-2; reactivation [G-B-3] mirrors
// Property's [G-B-2]). Insurance.expirationDate powers the list EXPIRES
// column (BR-MV-4). 1099-NEC overrides mirror RentalOwner (BR-MV-3).
//
// Tax identity enum reuses [G-S-25] (`SSN | EIN | ITIN`) declared in
// types/pm.ts.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { TaxIdentityType, StateOrProvince } from '@/types/pm';

export interface IVendorPhone {
  number: string;
  smsOptIn: boolean;
}

export interface IVendorAddress {
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: StateOrProvince | '';
  zip?: string;
  country?: string;
}

export interface IVendorInsurance {
  provider?: string;
  policyNumber?: string;
  expirationDate?: Date | null;
}

export interface IVendor {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** Optional for company vendors; required (via pre-validate) for individuals. */
  firstName?: string;
  /** Optional for company vendors; required (via pre-validate) for individuals. */
  lastName?: string;
  isCompany: boolean;
  companyName?: string;
  /** Default Uncategorized when null. */
  categoryId?: Types.ObjectId | null;
  /** Default expense account used to pre-fill Bill lines when none specified. */
  expenseAccountId?: Types.ObjectId | null;
  /** Vendor-assigned identifier for this customer ("our account number with
   *  the vendor"). Free text. */
  accountNumber?: string;
  primaryEmail?: string;
  alternateEmail?: string;
  phones: {
    mobile?: IVendorPhone;
    home?: IVendorPhone;
    work?: IVendorPhone;
    fax?: IVendorPhone;
  };
  address: IVendorAddress;
  website?: string;
  comments?: string;
  taxIdentityType?: TaxIdentityType | null;
  taxpayerIdLast4?: string;
  /** Phase 9 — full TIN required for 1099 generation (DECISIONS.md
   *  [G-S-30]). Stored plaintext under admin-only read; field-level
   *  encryption is a follow-up. Empty when only the masked last-4 is on
   *  file — the 1099 page surfaces a "TIN missing" warning. */
  taxpayerIdFull?: string;
  use1099AlternateName: boolean;
  alternativeName1099?: string;
  use1099AlternateAddress: boolean;
  alternativeAddress1099?: IVendorAddress;
  insurance: IVendorInsurance;
  customFields: Map<string, unknown>;
  /** Vendor-portal opt-in (BR-MV-12). When true the welcome-email action is
   *  enabled; impersonation via [G-B-6] keeps using NextAuth JWT shadow. */
  vendorPortalAccess: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const VendorPhoneSchema = new Schema<IVendorPhone>(
  {
    number: { type: String, trim: true, default: '' },
    smsOptIn: { type: Boolean, default: false },
  },
  { _id: false },
);

const VendorAddressSchema = new Schema<IVendorAddress>(
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

const VendorInsuranceSchema = new Schema<IVendorInsurance>(
  {
    provider: { type: String, trim: true, maxlength: 200 },
    policyNumber: { type: String, trim: true, maxlength: 120 },
    expirationDate: { type: Date, default: null },
  },
  { _id: false },
);

const VendorSchema = new Schema<IVendor>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    isCompany: { type: Boolean, default: false },
    companyName: { type: String, trim: true },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmVendorCategory',
      default: null,
    },
    expenseAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      default: null,
    },
    accountNumber: { type: String, trim: true, maxlength: 80 },
    primaryEmail: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    alternateEmail: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    phones: {
      mobile: { type: VendorPhoneSchema, default: undefined },
      home: { type: VendorPhoneSchema, default: undefined },
      work: { type: VendorPhoneSchema, default: undefined },
      fax: { type: VendorPhoneSchema, default: undefined },
    },
    address: { type: VendorAddressSchema, default: () => ({}) },
    website: { type: String, trim: true, maxlength: 500 },
    comments: { type: String, trim: true, maxlength: 4000 },
    taxIdentityType: {
      type: String,
      enum: ['SSN', 'EIN', 'ITIN'],
      default: null,
    },
    taxpayerIdLast4: {
      type: String,
      trim: true,
      validate: {
        validator: (v?: string) => !v || /^\d{4}$/.test(v),
        message: 'taxpayerIdLast4 must be exactly 4 digits',
      },
    },
    taxpayerIdFull: {
      type: String,
      trim: true,
      validate: {
        validator: (v?: string) => !v || /^[\d-]{9,11}$/.test(v),
        message: 'taxpayerIdFull must be 9 digits (with optional dashes)',
      },
    },
    use1099AlternateName: { type: Boolean, default: false },
    alternativeName1099: { type: String, trim: true },
    use1099AlternateAddress: { type: Boolean, default: false },
    alternativeAddress1099: { type: VendorAddressSchema, default: undefined },
    insurance: { type: VendorInsuranceSchema, default: () => ({}) },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    vendorPortalAccess: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_vendors' },
);

VendorSchema.index({ organizationId: 1, active: 1, lastName: 1, firstName: 1 });
VendorSchema.index({ organizationId: 1, 'insurance.expirationDate': 1 });
VendorSchema.index({ organizationId: 1, categoryId: 1 });

// A company vendor needs only a company name; an individual vendor needs a
// first + last name. Names are otherwise optional so a company can be saved
// with just its company name (mirrors Tenant's Individual/Company rule).
VendorSchema.pre('validate', function (next) {
  if (this.isCompany) {
    if (!this.companyName?.trim()) {
      return next(new Error('companyName is required when isCompany=true'));
    }
  } else {
    if (!this.firstName?.trim() || !this.lastName?.trim()) {
      return next(
        new Error('Individual vendors require firstName and lastName.'),
      );
    }
  }
  next();
});

export const Vendor: Model<IVendor> =
  (models.PmVendor as Model<IVendor>) ??
  model<IVendor>('PmVendor', VendorSchema);

export default Vendor;
