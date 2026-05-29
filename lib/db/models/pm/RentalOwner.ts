// RentalOwner — referenced by Property (junction) and by Lease.rentalOwnerId.
// The `propertiesOwned` junction is OWNED BY PROPERTY (Property.rentalOwners[]
// = [{ rentalOwnerId, ownershipPct }]). The RentalOwner GET-one route derives
// the inverse on read so the owner detail page is always live without dual-
// write risk. Soft-archive (BR-AC-18). Refs: PDR_MASTER §3.6.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { TaxIdentityType, StateOrProvince } from '@/types/pm';

export interface IRentalOwnerPhone {
  number: string;
  smsOptIn: boolean;
}

export interface IRentalOwnerAddress {
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: StateOrProvince | '';
  zip?: string;
  country?: string;
}

export interface IRentalOwner {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  firstName: string;
  lastName: string;
  isCompany: boolean;
  companyName?: string;
  dateOfBirth?: Date | null;
  managementAgreement: {
    startDate?: Date | null;
    endDate?: Date | null;
  };
  primaryEmail?: string;
  alternateEmail?: string;
  phones: {
    mobile?: IRentalOwnerPhone;
    home?: IRentalOwnerPhone;
    work?: IRentalOwnerPhone;
    fax?: IRentalOwnerPhone;
  };
  address: IRentalOwnerAddress;
  comments?: string;
  taxIdentityType?: TaxIdentityType | null;
  taxpayerIdLast4?: string;
  use1099AlternateName: boolean;
  alternativeName1099?: string;
  use1099AlternateAddress: boolean;
  alternativeAddress1099?: IRentalOwnerAddress;
  customFields: Map<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PhoneSchema = new Schema<IRentalOwnerPhone>(
  {
    number: { type: String, trim: true, default: '' },
    smsOptIn: { type: Boolean, default: false },
  },
  { _id: false },
);

const AddressSchema = new Schema<IRentalOwnerAddress>(
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

const RentalOwnerSchema = new Schema<IRentalOwner>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    isCompany: { type: Boolean, default: false },
    companyName: { type: String, trim: true },
    dateOfBirth: { type: Date, default: null },
    managementAgreement: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
    },
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
      mobile: { type: PhoneSchema, default: undefined },
      home: { type: PhoneSchema, default: undefined },
      work: { type: PhoneSchema, default: undefined },
      fax: { type: PhoneSchema, default: undefined },
    },
    address: { type: AddressSchema, default: () => ({}) },
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
    use1099AlternateName: { type: Boolean, default: false },
    alternativeName1099: { type: String, trim: true },
    use1099AlternateAddress: { type: Boolean, default: false },
    alternativeAddress1099: { type: AddressSchema, default: undefined },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_rental_owners' },
);

RentalOwnerSchema.index({ organizationId: 1, active: 1, lastName: 1, firstName: 1 });

// Conditional companyName when isCompany=true.
RentalOwnerSchema.pre('save', function (next) {
  if (this.isCompany && !this.companyName?.trim()) {
    return next(new Error('companyName is required when isCompany=true'));
  }
  next();
});

export const RentalOwner: Model<IRentalOwner> =
  (models.PmRentalOwner as Model<IRentalOwner>) ??
  model<IRentalOwner>('PmRentalOwner', RentalOwnerSchema);

export default RentalOwner;
