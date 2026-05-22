// Prospect — top of the leasing funnel (PDR_MASTER §3.9). Lightweight CRM
// record captured from inbound interest — tour requests, walk-ins, lead
// forms. Conversion to Applicant is one-way (BR-LA-3): once converted the
// Prospect.status flips to "Converted" and the cursor lives on the Applicant
// going forward.
//
// `status` enum [G-S-2] is resolved in @/types/pm.ts as the 6-value funnel.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { ProspectStatus } from '@/types/pm';
import { PROSPECT_STATUSES } from '@/types/pm';

export interface IProspect {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  status: ProspectStatus;
  propertyId?: Types.ObjectId | null;
  movingDate?: Date | null;
  beds?: number | null;
  /** Set when status → Converted; back-link to the Applicant that took over. */
  convertedToApplicantId?: Types.ObjectId | null;
  convertedAt?: Date | null;
  notes?: string;
  customFields: Map<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ProspectSchema = new Schema<IProspect>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    phone: { type: String, trim: true, maxlength: 40 },
    status: {
      type: String,
      enum: PROSPECT_STATUSES,
      default: 'New',
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      default: null,
    },
    movingDate: { type: Date, default: null },
    beds: { type: Number, min: 0, max: 10, default: null },
    convertedToApplicantId: {
      type: Schema.Types.ObjectId,
      ref: 'PmApplicant',
      default: null,
    },
    convertedAt: { type: Date, default: null },
    notes: { type: String, maxlength: 4000 },
    customFields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
  },
  { timestamps: true, collection: 'pm_prospects' },
);

ProspectSchema.index({
  organizationId: 1,
  status: 1,
  updatedAt: -1,
});
ProspectSchema.index({ organizationId: 1, lastName: 1, firstName: 1 });

export const Prospect: Model<IProspect> =
  (models.PmProspect as Model<IProspect>) ??
  model<IProspect>('PmProspect', ProspectSchema);

export default Prospect;
