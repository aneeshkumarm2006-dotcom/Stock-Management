// ProjectType — flat per-org taxonomy referenced by Project (Phase 5+).
// Default `Uncategorized` seeded at org bootstrap (Phase 0a [G-S-41]).
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IProjectType {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  color?: string;
  systemSeeded: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectTypeSchema = new Schema<IProjectType>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    color: { type: String, trim: true },
    systemSeeded: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_project_types' },
);

ProjectTypeSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const ProjectType: Model<IProjectType> =
  (models.PmProjectType as Model<IProjectType>) ??
  model<IProjectType>('PmProjectType', ProjectTypeSchema);

export default ProjectType;
