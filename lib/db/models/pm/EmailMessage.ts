// EmailMessage — PDR_MASTER §3.35. Polymorphic communications record that
// anchors every email sent, scheduled, drafted, or system-generated from the
// PM workspace. Phase 6 ships the full schema + persistence; actual SMTP
// dispatch is a stub (status moves Draft → Scheduled / Sending → Sent at the
// API boundary so the UI exercises the lifecycle end-to-end). Reply ingestion
// is deferred ([G-S-44]).
//
// Key behaviours encoded in the schema:
//   - `fromMailbox` is per-account or per-property (BR-CC-5). The Compose UI
//     picks the sending mailbox; we store the literal address so changing
//     org mailboxes later doesn't rewrite history.
//   - `isSystemGenerated` defaults to false and is hidden from the default
//     list view (BR-CC-4) — the list page applies the filter.
//   - `recipientCount` is derived on save so the list `To (24)` chip
//     (BR-CC-2) doesn't have to recompute on every render.
//   - `relatedEntityType` + `relatedEntityId` are the polymorphic Comms tab
//     anchor — Vendor detail / Property detail / Lease detail / Tenant
//     detail / RentalOwner detail / Applicant detail all read this pair
//     ([G-S-21]). The Compose modal stamps it from whichever surface
//     launched the modal.
//   - Attachments are PmFile rows with locationType='EmailMessage' (Phase 6
//     parentType extension); we mirror the file ids here for fast list
//     rendering ([G-S-45]).
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  EmailStatus,
  EmailRecipientType,
  EmailReadReceiptStatus,
  EmailRelatedEntityType,
} from '@/types/pm';

export interface IEmailRecipient {
  type: EmailRecipientType;
  /** ObjectId of the resolved entity. Null when `type='Custom'` (free email). */
  id: Types.ObjectId | null;
  /** Snapshot of the email address at send time (immutable). */
  email: string;
  /** Snapshot of the display name at send time. */
  name?: string;
}

export interface IEmailMessage {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** Mailbox the email was/will be sent from (BR-CC-5). Snapshotted address. */
  fromMailbox: string;
  /** Optional scoping property when the mailbox is per-property. */
  fromMailboxPropertyId?: Types.ObjectId | null;
  subject: string;
  to: IEmailRecipient[];
  cc: IEmailRecipient[];
  bcc: IEmailRecipient[];
  /** Rich-text HTML body. Plain text is the fallback in the UI's preview. */
  body: string;
  attachmentFileIds: Types.ObjectId[];
  /** Stamped when the email transitions out of `Draft` / `Scheduled`. */
  sentAt?: Date | null;
  senderUserId: Types.ObjectId;
  senderDisplayName: string;
  status: EmailStatus;
  isSystemGenerated: boolean;
  readReceiptStatus: EmailReadReceiptStatus;
  /** Required when `status='Scheduled'`; null otherwise. */
  scheduledSendTime?: Date | null;
  templateId?: Types.ObjectId | null;
  /** Derived: `to.length + cc.length + bcc.length`. Stamped on save. */
  recipientCount: number;
  /** Optional EmailThread cross-link ([G-S-42]). */
  threadId?: Types.ObjectId | null;
  /** Polymorphic anchor for the Communications tab renderer ([G-S-21]). */
  relatedEntityType?: EmailRelatedEntityType | null;
  relatedEntityId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const EmailRecipientSchema = new Schema<IEmailRecipient>(
  {
    type: {
      type: String,
      enum: [
        'Tenant',
        'RentalOwner',
        'Vendor',
        'Applicant',
        'Property',
        'Lease',
        'Custom',
      ],
      required: true,
    },
    id: { type: Schema.Types.ObjectId, default: null },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    name: { type: String, trim: true },
  },
  { _id: false },
);

const EmailMessageSchema = new Schema<IEmailMessage>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    fromMailbox: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    fromMailboxPropertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      default: null,
    },
    subject: { type: String, required: true, trim: true, maxlength: 500 },
    to: { type: [EmailRecipientSchema], default: () => [] },
    cc: { type: [EmailRecipientSchema], default: () => [] },
    bcc: { type: [EmailRecipientSchema], default: () => [] },
    body: { type: String, default: '' },
    attachmentFileIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'PmFile' }],
      default: () => [],
    },
    sentAt: { type: Date, default: null },
    senderUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderDisplayName: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['Draft', 'Scheduled', 'Sending', 'Sent', 'Failed'],
      default: 'Draft',
      required: true,
    },
    isSystemGenerated: { type: Boolean, default: false },
    readReceiptStatus: {
      type: String,
      enum: ['Not tracked', 'Unopened', 'Opened', 'Bounced'],
      default: 'Not tracked',
    },
    scheduledSendTime: { type: Date, default: null },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'PmEmailTemplate',
      default: null,
    },
    recipientCount: { type: Number, default: 0 },
    threadId: {
      type: Schema.Types.ObjectId,
      ref: 'PmEmailThread',
      default: null,
    },
    relatedEntityType: {
      type: String,
      enum: [
        'Property',
        'Lease',
        'Tenant',
        'RentalOwner',
        'Vendor',
        'Applicant',
        'WorkOrder',
        'Bill',
        'Task',
      ],
      default: null,
    },
    relatedEntityId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, collection: 'pm_email_messages' },
);

// List queries on Sent / Scheduled / Drafts hit this index first.
EmailMessageSchema.index({ organizationId: 1, status: 1, sentAt: -1 });
// Polymorphic Comms tab — every detail page reads via this combo.
EmailMessageSchema.index({
  organizationId: 1,
  relatedEntityType: 1,
  relatedEntityId: 1,
  sentAt: -1,
});
EmailMessageSchema.index({ organizationId: 1, threadId: 1, sentAt: 1 });

EmailMessageSchema.pre('save', function (next) {
  // recipientCount is derived; never trust client value.
  this.recipientCount =
    (this.to?.length ?? 0) + (this.cc?.length ?? 0) + (this.bcc?.length ?? 0);

  // Scheduled emails require a scheduledSendTime in the future.
  if (this.status === 'Scheduled') {
    if (!this.scheduledSendTime) {
      return next(
        new Error('scheduledSendTime is required when status=Scheduled'),
      );
    }
  } else if (this.status === 'Draft') {
    // Drafts must not carry a scheduledSendTime — the Compose flow promotes
    // Draft → Scheduled when the user picks a send time.
    this.scheduledSendTime = null;
  }

  // Sent emails get sentAt stamped exactly once.
  if (this.status === 'Sent' && !this.sentAt) {
    this.sentAt = new Date();
  }

  next();
});

export const EmailMessage: Model<IEmailMessage> =
  (models.PmEmailMessage as Model<IEmailMessage>) ??
  model<IEmailMessage>('PmEmailMessage', EmailMessageSchema);

export default EmailMessage;
