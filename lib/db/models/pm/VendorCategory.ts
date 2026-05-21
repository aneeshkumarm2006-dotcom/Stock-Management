// VendorCategory — `class × subCategory` taxonomy (PDR_MASTER §3.12).
// Default `Uncategorized` is system-seeded (BR-MV-1). `displayName` is a
// virtual rendering of `class - subCategory`.
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IVendorCategory {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** Top-level class (e.g. `Plumbing`). */
  class: string;
  /** Sub-classification (e.g. `Drain cleaning`). Blank for class-only rows. */
  subCategory: string;
  systemSeeded: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const VendorCategorySchema = new Schema<IVendorCategory>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    class: { type: String, required: true, trim: true },
    subCategory: { type: String, default: '', trim: true },
    systemSeeded: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_vendor_categories' },
);

VendorCategorySchema.virtual('displayName').get(function (this: IVendorCategory) {
  return this.subCategory ? `${this.class} - ${this.subCategory}` : this.class;
});

VendorCategorySchema.index(
  { organizationId: 1, class: 1, subCategory: 1 },
  { unique: true },
);

export const VendorCategory: Model<IVendorCategory> =
  (models.PmVendorCategory as Model<IVendorCategory>) ??
  model<IVendorCategory>('PmVendorCategory', VendorCategorySchema);

export default VendorCategory;
