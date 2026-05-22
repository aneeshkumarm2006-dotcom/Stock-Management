// Task — skeleton entity for Phase 4 (PDR_MASTER §3.13). Full UI ships in
// Phase 5; this file carries every field WorkOrder needs as a parent
// (BR-MV-5) plus the source* fields for the Resident-request / Owner-request
// join path ([G-B-29]).
//
// `taskId` is org-scoped monotonically increasing (BR-TP-7) — allocated by
// `lib/pm/taskIdSequence.ts` via the `pm_sequences` collection.
//
// Status + priority enums resolved in DECISIONS.md Phase 4 ([G-S-7] +
// [G-S-8]). `vendors[]` is multi-cardinality per [G-B-33].
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { TaskStatus, TaskType, WorkPriority } from '@/types/pm';

export const TASK_STATUSES_DB: TaskStatus[] = [
  'New',
  'In progress',
  'Completed',
  'Closed',
  'Cancelled',
  'On hold',
];

export const TASK_TERMINAL_STATUSES_DB: TaskStatus[] = [
  'Completed',
  'Closed',
  'Cancelled',
];

export const TASK_PRIORITIES_DB: WorkPriority[] = [
  'Low',
  'Normal',
  'High',
  'Urgent',
];

export const TASK_TYPES_DB: TaskType[] = [
  'To do',
  'Resident request',
  'Rental owner request',
  'Contact request',
];

export interface ITask {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** Org-scoped monotonic counter (BR-TP-7). */
  taskId: number;
  title: string;
  taskType: TaskType;
  status: TaskStatus;
  priority: WorkPriority;
  dueDate?: Date | null;
  categoryId?: Types.ObjectId | null;
  propertyId?: Types.ObjectId | null;
  unitId?: Types.ObjectId | null;
  /** Multi-vendor per [G-B-33]; affects status roll-up only when every
   *  child WO reaches a terminal status. */
  vendors: Types.ObjectId[];
  assignees: Types.ObjectId[];
  collaborators: Types.ObjectId[];
  /** Source* fields gated by taskType ([G-B-29]). */
  sourceTenantId?: Types.ObjectId | null;
  sourceOwnerId?: Types.ObjectId | null;
  sourceContactId?: Types.ObjectId | null;
  /** Free-text description / notes that survive into Phase 5. */
  description?: string;
  /** Back-references; updated whenever a WorkOrder is created with this
   *  Task as parent. */
  workOrders: Types.ObjectId[];
  /** Phase 5 [G-B-31] — many-to-many link to Project. The Project doc
   *  carries the symmetric `tasks[]`; the projects/[id]/tasks route keeps
   *  both sides in sync. */
  projectIds: Types.ObjectId[];
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    taskId: { type: Number, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    taskType: {
      type: String,
      enum: TASK_TYPES_DB,
      required: true,
      default: 'To do',
    },
    status: {
      type: String,
      enum: TASK_STATUSES_DB,
      required: true,
      default: 'New',
    },
    priority: {
      type: String,
      enum: TASK_PRIORITIES_DB,
      required: true,
      default: 'Normal',
    },
    dueDate: { type: Date, default: null },
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
    vendors: [{ type: Schema.Types.ObjectId, ref: 'PmVendor' }],
    assignees: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    collaborators: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    sourceTenantId: {
      type: Schema.Types.ObjectId,
      ref: 'PmTenant',
      default: null,
    },
    sourceOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'PmRentalOwner',
      default: null,
    },
    sourceContactId: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, trim: true, maxlength: 4000 },
    workOrders: [
      { type: Schema.Types.ObjectId, ref: 'PmWorkOrder' },
    ],
    projectIds: [{ type: Schema.Types.ObjectId, ref: 'PmProject' }],
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_tasks' },
);

TaskSchema.index({ organizationId: 1, taskId: 1 }, { unique: true });
TaskSchema.index({ organizationId: 1, status: 1, dueDate: 1 });
TaskSchema.index({ organizationId: 1, taskType: 1, status: 1 });
TaskSchema.index({ organizationId: 1, propertyId: 1, status: 1 });
TaskSchema.index({ organizationId: 1, sourceTenantId: 1 });
TaskSchema.index({ organizationId: 1, projectIds: 1 });
TaskSchema.index({ organizationId: 1, assignees: 1, status: 1 });

// Source* field is conditional on taskType.
TaskSchema.pre('save', function (next) {
  if (this.taskType === 'Resident request' && !this.sourceTenantId) {
    // Allow null — UI may seed source later. No-op.
  }
  if (this.taskType === 'Rental owner request' && !this.sourceOwnerId) {
    // Allow null — UI may seed source later. No-op.
  }
  next();
});

export const Task: Model<ITask> =
  (models.PmTask as Model<ITask>) ?? model<ITask>('PmTask', TaskSchema);

export default Task;
