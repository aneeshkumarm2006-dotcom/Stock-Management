// PmFile — universal polymorphic file record (PDR_MASTER §3.29).
// Named `PmFile` to avoid colliding with the Web platform `File` global.
// `locationType` is one of FILE_LOCATION_TYPES; `locationId` is null only
// when locationType === 'Account' (BR-FI-3 — account-level uploads).
// `uploadedAt` (= createdAt) is distinct from `lastModifiedAt` per BR-FI-4.
import { Schema, model, models, Types, type Model } from 'mongoose';
import { FILE_LOCATION_TYPES } from '@/lib/pm/parentTypes';
import type { FileLocationType, FileSharing } from '@/types/pm';
import { WarningSchema, type IWarning } from './_shared/WarningSchema';

export interface IPmFile {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  title: string;
  /** Visibility hint — NOT access control (BR-FI-7). */
  sharing: FileSharing;
  categoryId: Types.ObjectId;
  locationType: FileLocationType;
  /** Null only when locationType === 'Account'. */
  locationId: Types.ObjectId | null;
  mimeType: string;
  originalFilename: string;
  fileSize: number;
  /** Cloudinary `public_id` (e.g. `pm/<org>/abc123`). Used for delete + URL re-derivation. */
  storageKey: string;
  /** Cloudinary `secure_url` — direct download/view URL. Empty for legacy Phase 0 rows. */
  storageUrl: string;
  /** Cloudinary `resource_type` — one of image|video|raw. Required to delete. */
  resourceType: 'image' | 'video' | 'raw';
  uploadedByUserId: Types.ObjectId;
  lastModifiedByUserId: Types.ObjectId;
  lastModifiedAt: Date;
  warnings: IWarning[];
  createdAt: Date;
  updatedAt: Date;
}

const PmFileSchema = new Schema<IPmFile>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    title: { type: String, default: '', trim: true },
    sharing: {
      type: String,
      enum: ['Internal', 'Resident', 'Owner', 'PublicLink'],
      default: 'Internal',
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmFileCategory',
      default: null,
    },
    locationType: {
      type: String,
      enum: FILE_LOCATION_TYPES,
      required: true,
    },
    locationId: { type: Schema.Types.ObjectId, default: null },
    mimeType: { type: String, required: true },
    originalFilename: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 0 },
    storageKey: { type: String, required: true },
    storageUrl: { type: String, default: '' },
    resourceType: {
      type: String,
      enum: ['image', 'video', 'raw'],
      default: 'raw',
    },
    uploadedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastModifiedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastModifiedAt: { type: Date, required: true, default: () => new Date() },
    warnings: { type: [WarningSchema], default: [] },
  },
  { timestamps: true, collection: 'pm_files' },
);

PmFileSchema.index({ organizationId: 1, locationType: 1, locationId: 1 });
PmFileSchema.index({ organizationId: 1, categoryId: 1 });
PmFileSchema.index({ organizationId: 1, lastModifiedAt: -1 });

// The "locationId required unless Account" check moved to computeWarnings
// (FILE_MISSING_LOCATION). Account-scope uploads still null the field on
// save to keep the row consistent.
PmFileSchema.pre('save', function (next) {
  if (this.locationType === 'Account') this.locationId = null;
  next();
});

export const PmFile: Model<IPmFile> =
  (models.PmFile as Model<IPmFile>) ??
  model<IPmFile>('PmFile', PmFileSchema);

export default PmFile;
