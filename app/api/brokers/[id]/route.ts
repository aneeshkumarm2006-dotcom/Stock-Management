// Single-broker route — rename (PATCH) and delete (DELETE), always scoped to
// the owning userId so user A can never mutate user B's broker even by guessing
// an id (IDOR defense). Deletion is BLOCKED while any of the user's positions
// still point at the broker — reassign or clear those holdings first (via the
// Edit panel "Broker" dropdown). Mirrors app/api/companies/[id]/route.ts.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Broker } from '@/lib/db/models/Broker';
import { Position } from '@/lib/db/models/Position';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

const patchSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Broker name is required')
    .max(80, 'Broker name is too long'),
});

/** Mongo duplicate-key (unique index) errors surface as code 11000. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}

/** PATCH /api/brokers/[id] — rename the broker. */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { id } = params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Invalid broker id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const broker = await Broker.findOne({ _id: id, userId });
  if (!broker) {
    return NextResponse.json({ error: 'Broker not found' }, { status: 404 });
  }

  broker.name = parsed.data.name;
  try {
    await broker.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return NextResponse.json(
        { error: 'A broker with that name already exists' },
        { status: 409 },
      );
    }
    throw err;
  }

  const positionCount = await Position.countDocuments({ userId, brokerId: id });
  return NextResponse.json({
    id: String(broker._id),
    name: broker.name,
    positionCount,
    createdAt: broker.createdAt,
    updatedAt: broker.updatedAt,
  });
}

/** DELETE /api/brokers/[id] — remove a broker (blocked while in use). */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { id } = params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Invalid broker id' }, { status: 400 });
  }

  await connectToDatabase();

  // Block-while-in-use: a broker that still holds positions cannot be deleted.
  const positionCount = await Position.countDocuments({ userId, brokerId: id });
  if (positionCount > 0) {
    return NextResponse.json(
      {
        error: `This broker still holds ${positionCount} ${
          positionCount === 1 ? 'holding' : 'holdings'
        }. Reassign or clear them before deleting.`,
        positionCount,
      },
      { status: 409 },
    );
  }

  const result = await Broker.deleteOne({ _id: id, userId });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: 'Broker not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id });
}
