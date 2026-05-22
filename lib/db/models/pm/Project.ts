// Project — groups Tasks under a property-scoped initiative (PDR §3.15,
// Phase 5). Required FKs at creation: projectType, property, projectLead
// (BR-TP-8). Tasks are NOT accepted at creation time — the API
// /api/pm/projects/[id]/tasks does the post-creation linkage (BR-TP-8).
//
// Storage: budget is integer cents (Phase 2 convention). status is a flat
// `In progress | Closed` enum; PMs may close a Project with open Tasks.
//
// Decisions:
//   [G-B-31] Project ↔ Task linkage = many-to-many. Project.tasks[] is the
//            inverse of Task.projectIds[]; the API keeps both sides in sync.
import { Schema, model, models, Types, type Model } from 'mongoose';

export const PROJECT_STATUSES_DB = ['In progress', 'Closed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES_DB)[number];

export const PROJECT_TERMINAL_STATUSES_DB: ProjectStatus[] = ['Closed'];

export interface IProject {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  projectTypeId: Types.ObjectId;
  propertyId: Types.ObjectId;
  name?: string;
  description?: string;
  projectLeadUserId: Types.ObjectId;
  /** Integer cents (Phase 2 convention). Default 0. */
  budget: number;
  dueDate?: Date | null;
  /** Symmetric M:N inverse of Task.projectIds[]. */
  tasks: Types.ObjectId[];
  status: ProjectStatus;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    projectTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProjectType',
      required: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      required: true,
    },
    name: { type: String, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 4000 },
    projectLeadUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    budget: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, default: null },
    tasks: [{ type: Schema.Types.ObjectId, ref: 'PmTask' }],
    status: {
      type: String,
      enum: PROJECT_STATUSES_DB,
      required: true,
      default: 'In progress',
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_projects' },
);

ProjectSchema.index({ organizationId: 1, status: 1, propertyId: 1 });
ProjectSchema.index({ organizationId: 1, projectLeadUserId: 1 });
ProjectSchema.index({ organizationId: 1, dueDate: 1 });

export const Project: Model<IProject> =
  (models.PmProject as Model<IProject>) ??
  model<IProject>('PmProject', ProjectSchema);

export default Project;
