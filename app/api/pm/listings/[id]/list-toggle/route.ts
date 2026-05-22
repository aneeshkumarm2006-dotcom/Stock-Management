// POST /api/pm/listings/:id/list-toggle
//
// Implements BR-LA-1: a Unit must be Unlisted before listing. Flipping the
// `listed` boolean from false→true requires that no Active or Future Lease
// references the unit. Flipping true→false is always allowed (delist).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Listing } from '@/lib/db/models/pm/Listing';
import { Lease } from '@/lib/db/models/pm/Lease';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const bodySchema = z.object({ listed: z.boolean() });

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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await Listing.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // BR-LA-1 — block listing when the unit carries an Active or Future lease.
  if (parsed.data.listed && !doc.listed) {
    const blocker = await Lease.findOne({
      organizationId: new Types.ObjectId(ctx.orgId),
      unitId: doc.unitId,
      status: { $in: ['Active', 'Future'] },
    })
      .select({ _id: 1, leaseNumber: 1, status: 1 })
      .lean<{ _id: Types.ObjectId; leaseNumber: number; status: string } | null>();
    if (blocker) {
      return NextResponse.json(
        {
          error: 'Unit is currently occupied (BR-LA-1).',
          blockingLease: {
            id: String(blocker._id),
            leaseNumber: blocker.leaseNumber,
            status: blocker.status,
          },
        },
        { status: 409 },
      );
    }
  }

  doc.listed = parsed.data.listed;
  if (parsed.data.listed && !doc.listedDate) {
    doc.listedDate = new Date();
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Listing',
    parentId: doc._id,
    eventType: parsed.data.listed ? 'Listing listed' : 'Listing delisted',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true, listed: doc.listed });
}
