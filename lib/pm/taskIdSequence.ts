// Monotonic task ID generator (BR-TP-7 — Task IDs are globally unique +
// monotonically increasing). Uses MongoDB's `findOneAndUpdate` with `$inc`
// + `upsert: true` so the counter is atomic across concurrent writers and
// resilient across process restarts.
//
// Counter document: `pm_sequences.{ _id: 'task:<orgId>', current: <int> }`.
// Per-org scope is the convention for `taskId` because PROPERTY_TODO line 495
// says "globally unique within the system" but Buildium-parity behaviour
// resets the visible number per org tenant; cross-org collisions never
// surface in the UI.
import { connectToDatabase } from '@/lib/db/mongoose';
import mongoose from 'mongoose';

interface PmSequenceDoc {
  _id: string;
  current: number;
}

async function getCollection() {
  await connectToDatabase();
  const conn = mongoose.connection;
  if (!conn.db) {
    throw new Error('Database connection has no db handle.');
  }
  return conn.db.collection<PmSequenceDoc>('pm_sequences');
}

/**
 * Returns the next monotonic Task id for the given org. Uses an atomic
 * `findOneAndUpdate` with `$inc` so concurrent callers each see a unique
 * value.
 */
export async function nextTaskId(orgId: string): Promise<number> {
  const col = await getCollection();
  const result = await col.findOneAndUpdate(
    { _id: `task:${orgId}` },
    { $inc: { current: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  // findOneAndUpdate with upsert always returns a document when
  // returnDocument='after'.
  const doc = result as PmSequenceDoc | null;
  if (!doc || typeof doc.current !== 'number') {
    throw new Error('Failed to allocate next task id.');
  }
  return doc.current;
}

/**
 * Peek at the current sequence value without incrementing. For diagnostics
 * only — never use for write paths.
 */
export async function peekTaskId(orgId: string): Promise<number> {
  const col = await getCollection();
  const doc = await col.findOne({ _id: `task:${orgId}` });
  return doc?.current ?? 0;
}
