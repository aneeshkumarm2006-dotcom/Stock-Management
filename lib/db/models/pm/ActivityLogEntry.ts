// ActivityLogEntry — immutable cross-cutting audit row (PDR_MASTER §3.38).
// Drives the `Event history` tab on every detail page and the Recent Activity
// widget on the Dashboard.
// Invariant: rows are append-only. Update/delete is blocked at the schema
// layer; the actor is always preserved even if the User is later deactivated
// (BR-CX-4).
import { Schema, model, models, Types, type Model } from 'mongoose';
import { PARENT_TYPES } from '@/lib/pm/parentTypes';
import type { ParentType } from '@/types/pm';

export interface IActivityLogEntry {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  parentType: ParentType;
  parentId: Types.ObjectId;
  eventType: string;
  /** Acting user. NULL only for system-originated events that have no human
   *  actor (DEL-006: inbound email ingest). Every human-triggered route still
   *  stamps `ctx.userId`. */
  actorUserId: Types.ObjectId | null;
  payload?: Record<string, unknown>;
  createdAt: Date;
}

const ActivityLogEntrySchema = new Schema<IActivityLogEntry>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    parentType: { type: String, enum: PARENT_TYPES, required: true },
    parentId: { type: Schema.Types.ObjectId, required: true },
    eventType: { type: String, required: true, trim: true },
    actorUserId: {
      // Nullable (DEL-006): system-originated events (inbound email ingest)
      // have no human actor. Human-triggered routes always pass ctx.userId.
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    payload: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'pm_activity_log',
  },
);

ActivityLogEntrySchema.index({
  organizationId: 1,
  parentType: 1,
  parentId: 1,
  createdAt: -1,
});
ActivityLogEntrySchema.index({ organizationId: 1, createdAt: -1 });

// Immutability: block in-place updates after creation.
ActivityLogEntrySchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('ActivityLogEntry is append-only'));
  }
  next();
});

export const ActivityLogEntry: Model<IActivityLogEntry> =
  (models.PmActivityLogEntry as Model<IActivityLogEntry>) ??
  model<IActivityLogEntry>('PmActivityLogEntry', ActivityLogEntrySchema);

export default ActivityLogEntry;
