// Brokers collection route — list (GET) and create (POST) the signed-in user's
// brokerages. A broker is the optional custodian a holding sits at, used to
// "split by broker" in the portfolio. Every query is scoped to the
// session-derived userId; the client-supplied id is never trusted (IDOR
// defense, mirrors app/api/companies/route.ts).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Broker } from '@/lib/db/models/Broker';
import { Position } from '@/lib/db/models/Position';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

// Mongoose needs the Node runtime (not Edge).
export const runtime = 'nodejs';

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Broker name is required')
    .max(80, 'Broker name is too long'),
});

/**
 * GET /api/brokers — the user's brokers, each with a `positionCount` of how
 * many holdings currently point at it (used to gate deletion — a broker with
 * holdings cannot be deleted).
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  await connectToDatabase();
  const brokers = await Broker.find({ userId }).sort({ name: 1 }).lean();

  // One aggregation for the held-at counts. NOTE: aggregation `$match` does not
  // auto-cast like a query, so userId must be a real ObjectId here.
  const counts = await Position.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { userId: new Types.ObjectId(userId), brokerId: { $ne: null } } },
    { $group: { _id: '$brokerId', count: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map((c) => [String(c._id), c.count]));

  return NextResponse.json({
    brokers: brokers.map((b) => ({
      id: String(b._id),
      name: b.name,
      positionCount: countById.get(String(b._id)) ?? 0,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    })),
  });
}

/** POST /api/brokers — create a broker for the current user. */
export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  try {
    const created = await Broker.create({ userId, name: parsed.data.name });
    return NextResponse.json(
      {
        id: String(created._id),
        name: created.name,
        positionCount: 0,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return NextResponse.json(
        { error: 'A broker with that name already exists' },
        { status: 409 },
      );
    }
    throw err;
  }
}

/** Mongo duplicate-key (unique index) errors surface as code 11000. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}
