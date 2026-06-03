// Activity logging helper. Every mutating PM route calls this so the
// `Event history` tab on every detail page is populated automatically
// (BR-CX-4 — every mutating action writes one ActivityLogEntry; actor =
// acting user).
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ActivityLogEntry } from '@/lib/db/models/pm/ActivityLogEntry';
import type { ParentType } from '@/types/pm';

export interface LogActivityInput {
  orgId: string | Types.ObjectId;
  parentType: ParentType;
  parentId: string | Types.ObjectId;
  eventType: string;
  /** Acting user. Pass `null` for system-originated events that have no human
   *  actor (DEL-006: inbound email ingest). */
  actorUserId: string | Types.ObjectId | null;
  payload?: Record<string, unknown>;
}

function toObjectId(v: string | Types.ObjectId): Types.ObjectId {
  return typeof v === 'string' ? new Types.ObjectId(v) : v;
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await connectToDatabase();
    await ActivityLogEntry.create({
      organizationId: toObjectId(input.orgId),
      parentType: input.parentType,
      parentId: toObjectId(input.parentId),
      eventType: input.eventType,
      actorUserId: input.actorUserId == null ? null : toObjectId(input.actorUserId),
      payload: input.payload,
    });
  } catch (err) {
    // Activity logging must never break the parent write. Surface to logs
    // so an alerting hook can pick it up later.
    console.error('logActivity failed', err);
  }
}

export default logActivity;
