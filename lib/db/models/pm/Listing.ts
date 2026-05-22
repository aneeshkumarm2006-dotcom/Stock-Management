// Listing — public-facing advertisement for a Unit (PDR_MASTER §3.8).
// One Listing per Unit at a time (BR-LA-1 implies single-active). The
// `listed` boolean is the user-facing toggle that surfaces the unit on the
// `Listed` vs `Unlisted` tabs (BR-LA-1). When the Unit becomes occupied the
// route handler flips `listed=false` automatically (gated by Phase 3 Lease).
//
// Storage:
//   - `listingRent` / `listingDeposit` are integer cents (lib/pm/currency.ts).
//   - `unitImages` is an array of PmFile ObjectIds — uploads use the
//     polymorphic File store (locationType=Listing). Phase 8 surfaces them
//     on the central Files page.
//
// Derived (computed on read by the route):
//   - propertyName / address rollups (from Property)
//   - daysListed (Date.now − listedDate)
//
// History: `listedDate` is auto-set when `listed` flips false→true. We don't
// blank it on delist so the audit log can show "listed for 14 days".
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IListing {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  unitId: Types.ObjectId;
  propertyId: Types.ObjectId;
  listed: boolean;
  listedDate?: Date | null;
  availableDate?: Date | null;
  listingRent: number; // cents
  listingDeposit: number; // cents
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  unitAmenities: string[];
  unitDescription?: string;
  unitImages: Types.ObjectId[]; // PmFile refs
  leaseTermsBlurb?: string;
  customFields: Map<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ListingSchema = new Schema<IListing>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PmUnit',
      required: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      required: true,
    },
    listed: { type: Boolean, default: false },
    listedDate: { type: Date, default: null },
    availableDate: { type: Date, default: null },
    listingRent: { type: Number, default: 0, min: 0 },
    listingDeposit: { type: Number, default: 0, min: 0 },
    contactName: { type: String, trim: true, maxlength: 120 },
    contactPhone: { type: String, trim: true, maxlength: 40 },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    unitAmenities: { type: [String], default: [] },
    unitDescription: { type: String, maxlength: 8000 },
    unitImages: {
      type: [{ type: Schema.Types.ObjectId, ref: 'PmFile' }],
      default: [],
    },
    leaseTermsBlurb: { type: String, maxlength: 2000 },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
  },
  { timestamps: true, collection: 'pm_listings' },
);

// One Listing per Unit. The unique index makes `BR-LA-1` (unit must be
// Unlisted before listing) trivially enforced at the storage layer too —
// you can't accidentally create two Listings for the same Unit.
ListingSchema.index(
  { organizationId: 1, unitId: 1 },
  { unique: true },
);
ListingSchema.index({ organizationId: 1, listed: 1, updatedAt: -1 });

// Auto-stamp `listedDate` on the unlisted → listed transition so the
// `Listed date` sidebar reads truthfully without depending on the route to
// remember to set it.
ListingSchema.pre('save', function (next) {
  if (this.isModified('listed') && this.listed && !this.listedDate) {
    this.listedDate = new Date();
  }
  next();
});

export const Listing: Model<IListing> =
  (models.PmListing as Model<IListing>) ??
  model<IListing>('PmListing', ListingSchema);

export default Listing;
