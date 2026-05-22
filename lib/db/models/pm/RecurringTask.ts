// RecurringTask — cadence-driven Task generator (PDR_MASTER §3.14, Phase 5).
// Mirrors the RecurringTransaction shape so the cadence engine
// (`lib/pm/recurringTaskPoster.ts`) can reuse the same advance-next-date math
// and "already posted for this nextDate" guard.
//
// BR-TP-5: the Add-recurring-task dropdown omits `Contact request`, and the
// schema enforces the same — a pre('validate') hook rejects the value to
// guarantee the constraint at the DB layer too.
//
// Decisions:
//   [G-S-9]  cadence enum = Weekly | Monthly | Quarterly | Yearly
//            (mirror RecurringTransaction; DECISIONS.md Phase 5)
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  RecurringDuration,
  RecurringFrequency,
  TaskType,
  WorkPriority,
} from '@/types/pm';
import {
  RECURRING_DURATIONS_DB,
  RECURRING_FREQUENCIES_DB,
} from '@/lib/db/models/pm/RecurringTransaction';

/** Subset of TaskType excluding `Contact request` (BR-TP-5). */
export const RECURRING_TASK_TYPES_DB: Exclude<TaskType, 'Contact request'>[] = [
  'To do',
  'Resident request',
  'Rental owner request',
];

export const RECURRING_TASK_PRIORITIES_DB: WorkPriority[] = [
  'Low',
  'Normal',
  'High',
  'Urgent',
];

export interface IRecurringTask {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  title: string;
  taskType: Exclude<TaskType, 'Contact request'>;
  cadence: RecurringFrequency;
  nextDate: Date;
  priority: WorkPriority;
  categoryId?: Types.ObjectId | null;
  propertyId?: Types.ObjectId | null;
  unitId?: Types.ObjectId | null;
  assignees: Types.ObjectId[];
  description?: string;
  /** Mirrors RecurringTransaction.duration — Until cancelled vs End after N. */
  duration: RecurringDuration;
  /** Required when duration='End after N'. */
  occurrenceCount?: number | null;
  active: boolean;
  /** Last `nextDate` value the poster ran for. */
  lastPostedDate?: Date | null;
  /** Count of Task instances generated so far. */
  postedCount: number;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringTaskSchema = new Schema<IRecurringTask>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    taskType: {
      type: String,
      enum: RECURRING_TASK_TYPES_DB,
      required: true,
      default: 'To do',
    },
    cadence: {
      type: String,
      enum: RECURRING_FREQUENCIES_DB,
      required: true,
    },
    nextDate: { type: Date, required: true },
    priority: {
      type: String,
      enum: RECURRING_TASK_PRIORITIES_DB,
      required: true,
      default: 'Normal',
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmTaskCategory',
      default: null,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      default: null,
    },
    unitId: { type: Schema.Types.ObjectId, ref: 'PmUnit', default: null },
    assignees: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    description: { type: String, trim: true, maxlength: 4000 },
    duration: {
      type: String,
      enum: RECURRING_DURATIONS_DB,
      required: true,
      default: 'Until cancelled',
    },
    occurrenceCount: { type: Number, default: null, min: 1 },
    active: { type: Boolean, default: true },
    lastPostedDate: { type: Date, default: null },
    postedCount: { type: Number, default: 0 },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_recurring_tasks' },
);

RecurringTaskSchema.index({ organizationId: 1, active: 1, nextDate: 1 });
RecurringTaskSchema.index({ organizationId: 1, propertyId: 1 });

RecurringTaskSchema.pre('validate', function (next) {
  // BR-TP-5 — schema-level guarantee even if the API ever lets it through.
  if ((this.taskType as string) === 'Contact request') {
    return next(
      new Error(
        'RecurringTask.taskType cannot be "Contact request" (BR-TP-5).',
      ),
    );
  }
  if (
    this.duration === 'End after N' &&
    (!this.occurrenceCount || this.occurrenceCount < 1)
  ) {
    return next(
      new Error(
        'occurrenceCount must be a positive integer when duration is "End after N".',
      ),
    );
  }
  next();
});

export const RecurringTask: Model<IRecurringTask> =
  (models.PmRecurringTask as Model<IRecurringTask>) ??
  model<IRecurringTask>('PmRecurringTask', RecurringTaskSchema);

export default RecurringTask;
