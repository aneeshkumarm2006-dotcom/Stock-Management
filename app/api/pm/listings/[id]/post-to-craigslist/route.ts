// POST /api/pm/listings/:id/post-to-craigslist
//
// BR-LA-2 stub. Returns `{ ok: true, channel: 'craigslist', postedAt }` and
// writes an ActivityLogEntry so the audit trail captures the click — the
// actual Craigslist (or other channel [G-B-25]) integration lands in Phase 6
// Communications.
// TODO Phase 6 — wire real outbound listing dispatcher.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Listing } from '@/lib/db/models/pm/Listing';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  await connectToDatabase();
  const doc = await Listing.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  })
    .select({ _id: 1, listed: 1 })
    .lean<{ _id: Types.ObjectId; listed: boolean } | null>();
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!doc.listed) {
    return NextResponse.json(
      { error: 'Unit must be Listed before posting to channels (BR-LA-2).' },
      { status: 400 },
    );
  }

  const postedAt = new Date().toISOString();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Listing',
    parentId: doc._id,
    eventType: 'Listing posted to Craigslist',
    actorUserId: ctx.userId,
    payload: { channel: 'craigslist', postedAt },
  });

  return NextResponse.json({
    ok: true,
    channel: 'craigslist',
    postedAt,
    todo: 'Phase 6 — real Craigslist integration',
  });
}
