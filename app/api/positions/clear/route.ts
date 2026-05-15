// "Clear all data" — deletes every Position owned by the signed-in user
// (Settings page, PDR §5.7). Scoped to the session-derived userId so a user
// can only ever wipe their own holdings (IDOR-safe, like every per-user
// route). A static segment, so it resolves ahead of /api/positions/[id].
// Refs: PDR.md §5.7, §6 (Position), §12 (user isolation).
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

/** DELETE /api/positions/clear — remove all of the current user's positions. */
export async function DELETE() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  await connectToDatabase();
  const result = await Position.deleteMany({ userId });

  return NextResponse.json({ deleted: result.deletedCount ?? 0 });
}
