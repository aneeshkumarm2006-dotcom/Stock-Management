// POST /api/pm/leases/:id/eviction
//
// Toggles the EVICTION PENDING overlay attribute (BR-LL-3). Manual trigger
// only for Phase 3 ([G-B-9]); auto-trigger from NSF/late-fee events lands
// in Phase 6.
// TODO Phase 6 — late-fee + NSF auto-triggers.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { leaseEvictionToggleSchema } from '@/lib/validation/pm/lease';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = leaseEvictionToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await Lease.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  doc.evictionPending = parsed.data.evictionPending;
  if (parsed.data.evictionPendingNote !== undefined) {
    doc.evictionPendingNote = parsed.data.evictionPendingNote;
  } else if (!parsed.data.evictionPending) {
    doc.evictionPendingNote = undefined;
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Lease',
    parentId: doc._id,
    eventType: parsed.data.evictionPending
      ? 'Lease eviction pending flagged'
      : 'Lease eviction pending cleared',
    actorUserId: ctx.userId,
    payload: parsed.data.evictionPendingNote
      ? { note: parsed.data.evictionPendingNote }
      : undefined,
  });

  return NextResponse.json({
    ok: true,
    evictionPending: doc.evictionPending,
  });
}
