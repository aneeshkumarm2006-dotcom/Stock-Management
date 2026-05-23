// EmailTemplate — PDR_MASTER §3.36 (skeleton). Phase 6 persists the entity so
// Compose can offer template insertion, but the dedicated
// `/communication/templates` editor remains a ComingSoon. Variables are stored
// as a bare list of variable names ([G-S-22]); the Compose modal substitutes
// values at send time via the recipient resolver.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { EmailTemplateType } from '@/types/pm';

export interface IEmailTemplate {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  subject: string;
  body: string;
  /** Free list of variable tokens, e.g. ["tenantName", "leaseEndDate"]. */
  variables: string[];
  type: EmailTemplateType;
  /** Optional audience scope ([G-S-23]) — null = available to everyone. */
  audienceScope?: 'Active tenants' | 'All tenants' | 'All owners' | 'Vendors' | null;
  createdByUserId: Types.ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateSchema = new Schema<IEmailTemplate>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    subject: { type: String, required: true, trim: true, maxlength: 500 },
    body: { type: String, default: '' },
    variables: { type: [String], default: () => [] },
    type: {
      type: String,
      enum: ['Tenant', 'RentalOwner', 'Vendor', 'Applicant', 'General'],
      default: 'General',
    },
    audienceScope: {
      type: String,
      enum: [
        'Active tenants',
        'All tenants',
        'All owners',
        'Vendors',
        null,
      ],
      default: null,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_email_templates' },
);

EmailTemplateSchema.index({ organizationId: 1, active: 1, name: 1 });
EmailTemplateSchema.index({ organizationId: 1, type: 1 });

export const EmailTemplate: Model<IEmailTemplate> =
  (models.PmEmailTemplate as Model<IEmailTemplate>) ??
  model<IEmailTemplate>('PmEmailTemplate', EmailTemplateSchema);

export default EmailTemplate;
