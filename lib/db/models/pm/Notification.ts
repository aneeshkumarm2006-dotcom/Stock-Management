// Notification — header bell-badge queue (Phase 0 — UI only).
// Phase 1+ writers (lease nearing expiry, EFT awaiting approval, etc.) populate
// these. Phase 0 ships an empty collection so the badge renders `0`.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { NotificationKind } from '@/types/pm';

export interface INotification {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  recipientUserId: Types.ObjectId;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Optional deep-link href. */
  link?: string;
  /** Null until read. */
  readAt?: Date | null;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kind: {
      type: String,
      enum: ['info', 'warning', 'alert'],
      default: 'info',
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true },
    link: { type: String, trim: true },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'pm_notifications',
  },
);

NotificationSchema.index({
  organizationId: 1,
  recipientUserId: 1,
  readAt: 1,
  createdAt: -1,
});

export const Notification: Model<INotification> =
  (models.PmNotification as Model<INotification>) ??
  model<INotification>('PmNotification', NotificationSchema);

export default Notification;
