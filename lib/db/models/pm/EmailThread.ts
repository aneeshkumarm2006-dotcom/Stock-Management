// EmailThread — PDR_MASTER §3.37 (skeleton). Phase 6 persists the entity so
// the /communication/emails/threads sub-route can group messages, but reply
// ingestion ([G-S-44]) lands later. For now, EmailMessage rows are grouped
// on subject + participants when a thread is materialised manually or by the
// API on first send.
//
// `participantCount`, `messageCount`, and `lastActivityTime` are derived —
// they're refreshed by the EmailMessage POST handler whenever a message lands
// in this thread.
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IEmailThreadParticipant {
  /** Snapshot email of the participant. */
  email: string;
  /** Optional snapshot display name. */
  name?: string;
}

export interface IEmailThread {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  subject: string;
  participants: IEmailThreadParticipant[];
  participantCount: number;
  messageCount: number;
  lastActivityTime: Date;
  /** Grouping key ([G-S-42]) — normalised subject + sorted participant set. */
  groupingKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const ParticipantSchema = new Schema<IEmailThreadParticipant>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    name: { type: String, trim: true },
  },
  { _id: false },
);

const EmailThreadSchema = new Schema<IEmailThread>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 500 },
    participants: { type: [ParticipantSchema], default: () => [] },
    participantCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    lastActivityTime: { type: Date, default: () => new Date() },
    groupingKey: { type: String, required: true, index: true },
  },
  { timestamps: true, collection: 'pm_email_threads' },
);

EmailThreadSchema.index({ organizationId: 1, lastActivityTime: -1 });
EmailThreadSchema.index(
  { organizationId: 1, groupingKey: 1 },
  { unique: true },
);

/**
 * Build the grouping key shared by EmailMessage POST and the threads list.
 * Normalises the subject (strip `Re:`/`Fwd:` prefixes, lowercase, collapse
 * whitespace) and concatenates the sorted participant emails. Pure helper —
 * exported so callers can compute the key before issuing a Mongo upsert.
 */
export function computeThreadGroupingKey(
  subject: string,
  participantEmails: string[],
): string {
  const normalisedSubject = subject
    .replace(/^\s*(re|fwd|fw):\s*/i, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  const sortedParticipants = Array.from(
    new Set(participantEmails.map((e) => e.toLowerCase().trim())),
  )
    .filter(Boolean)
    .sort();
  return `${normalisedSubject}|${sortedParticipants.join(',')}`;
}

export const EmailThread: Model<IEmailThread> =
  (models.PmEmailThread as Model<IEmailThread>) ??
  model<IEmailThread>('PmEmailThread', EmailThreadSchema);

export default EmailThread;
