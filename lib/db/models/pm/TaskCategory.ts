// TaskCategory — flat per-org taxonomy referenced by Task, RecurringTask,
// WorkOrder (Phase 4+). Default `Uncategorized` seeded at org bootstrap.
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface ITaskCategory {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  /** Optional UI hint (hex). */
  color?: string;
  systemSeeded: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TaskCategorySchema = new Schema<ITaskCategory>(
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
  { timestamps: true, collection: 'pm_task_categories' },
);

TaskCategorySchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const TaskCategory: Model<ITaskCategory> =
  (models.PmTaskCategory as Model<ITaskCategory>) ??
  model<ITaskCategory>('PmTaskCategory', TaskCategorySchema);

export default TaskCategory;
