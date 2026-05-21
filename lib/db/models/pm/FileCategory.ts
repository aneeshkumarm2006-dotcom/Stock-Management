// FileCategory — taxonomy for PmFile. Org-scoped; `Leases` is system-seeded
// and undeletable (BR-FI-2). Delete is blocked while `inUseCount > 0`
// (BR-FI-6); the counter is maintained by PmFile create/delete hooks.
// Refs: PDR_MASTER §3.29a; PROPERTY_TODO.md Phase 0.
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IFileCategory {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  /** System-seeded categories (e.g. `Leases`) cannot be deleted. */
  systemSeeded: boolean;
  /**
   * Denormalized count of PmFiles referencing this category. Maintained by
   * `pre('save')`/`pre('deleteOne')` hooks on PmFile. The recount endpoint
   * exists as a backstop.
   */
  inUseCount: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FileCategorySchema = new Schema<IFileCategory>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    systemSeeded: { type: Boolean, default: false },
    inUseCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_file_categories' },
);

FileCategorySchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const FileCategory: Model<IFileCategory> =
  (models.PmFileCategory as Model<IFileCategory>) ??
  model<IFileCategory>('PmFileCategory', FileCategorySchema);

export default FileCategory;
