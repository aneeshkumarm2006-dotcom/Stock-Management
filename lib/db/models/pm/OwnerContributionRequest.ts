// OwnerContributionRequest — skeleton entity for Phase 5 (PDR §3.25). Full
// UI ships in Phase 9 alongside the A/P "Request owner contribution" flow;
// the skeleton lands here so the Task cross-link can be populated by the
// Phase 5 Task detail page.
//
// `taskDescription` is renamed from PDR's `task` field to avoid the JS
// reserved word + the Task entity sharing the namespace. The Task cross-link
// is `taskId`.
import { Schema, model, models, Types, type Model } from 'mongoose';
import { WarningSchema, type IWarning } from './_shared/WarningSchema';

export const OWNER_CONTRIBUTION_STATUSES_DB = [
  'New',
  'In progress',
  'Completed',
] as const;
export type OwnerContributionStatus =
  (typeof OWNER_CONTRIBUTION_STATUSES_DB)[number];

export const OWNER_CONTRIBUTION_PRIORITIES_DB = [
  'Low',
  'Normal',
  'High',
] as const;
export type OwnerContributionPriority =
  (typeof OWNER_CONTRIBUTION_PRIORITIES_DB)[number];

export interface IOwnerContributionRequest {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  status: OwnerContributionStatus;
  dueDate: Date;
  propertiesScope: string;
  /** Free-text description of need (PDR §3.25 `task`). */
  taskDescription: string;
  requestedFromOwnerId: Types.ObjectId;
  priority: OwnerContributionPriority;
  /** Integer cents. */
  requestedAmount: number;
  /** Integer cents. */
  receivedAmount: number;
  /** Cross-link to PmTask. */
  taskId?: Types.ObjectId | null;
  createdByUserId: Types.ObjectId;
  warnings: IWarning[];
  createdAt: Date;
  updatedAt: Date;
}

const OwnerContributionRequestSchema = new Schema<IOwnerContributionRequest>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    status: {
      type: String,
      enum: OWNER_CONTRIBUTION_STATUSES_DB,
      required: true,
      default: 'New',
    },
    dueDate: { type: Date, default: null },
    propertiesScope: { type: String, default: '', trim: true, maxlength: 200 },
    taskDescription: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    requestedFromOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'PmRentalOwner',
      default: null,
    },
    priority: {
      type: String,
      enum: OWNER_CONTRIBUTION_PRIORITIES_DB,
      required: true,
      default: 'Normal',
    },
    requestedAmount: { type: Number, default: 0, min: 0 },
    receivedAmount: { type: Number, default: 0, min: 0 },
    taskId: { type: Schema.Types.ObjectId, ref: 'PmTask', default: null },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    warnings: { type: [WarningSchema], default: [] },
  },
  { timestamps: true, collection: 'pm_owner_contribution_requests' },
);

OwnerContributionRequestSchema.index({
  organizationId: 1,
  status: 1,
  dueDate: 1,
});
OwnerContributionRequestSchema.index({
  organizationId: 1,
  requestedFromOwnerId: 1,
});
OwnerContributionRequestSchema.index({ organizationId: 1, taskId: 1 });

export const OwnerContributionRequest: Model<IOwnerContributionRequest> =
  (models.PmOwnerContributionRequest as Model<IOwnerContributionRequest>) ??
  model<IOwnerContributionRequest>(
    'PmOwnerContributionRequest',
    OwnerContributionRequestSchema,
  );

export default OwnerContributionRequest;
