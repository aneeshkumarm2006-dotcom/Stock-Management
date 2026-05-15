// Single-position route — edit (PATCH) and delete (DELETE), always scoped to
// the owning userId so user A can never read or mutate user B's holdings even
// by guessing an id (PDR §12, IDOR defense). PATCH supports a direct edit and
// an "add to position" recompute mode (PDR §5.1).
// Refs: PDR.md §5.1, §5.3, §6 (Position), §11.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

// Direct edit: change quantity and/or avg buy price (at least one).
const replaceSchema = z
  .object({
    mode: z.literal('replace').optional(),
    quantity: z.number().positive('Quantity must be greater than 0').optional(),
    avgBuyPrice: z
      .number()
      .min(0, 'Average buy price cannot be negative')
      .optional(),
  })
  .refine((d) => d.quantity !== undefined || d.avgBuyPrice !== undefined, {
    message: 'Provide quantity and/or avgBuyPrice',
  });

// "Add to position" — supply the follow-on lot; the new average is the
// quantity-weighted mean of the existing lot and the added lot.
const addSchema = z.object({
  mode: z.literal('add'),
  addQuantity: z.number().positive('Added quantity must be greater than 0'),
  addPrice: z.number().min(0, 'Added price cannot be negative'),
});

const patchSchema = z.union([addSchema, replaceSchema]);

function serialize(p: {
  _id: unknown;
  ticker: string;
  exchange: string;
  quantity: number;
  avgBuyPrice: number;
  currency: string;
  buyDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(p._id),
    ticker: p.ticker,
    exchange: p.exchange,
    quantity: p.quantity,
    avgBuyPrice: p.avgBuyPrice,
    currency: p.currency,
    buyDate: p.buyDate ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** PATCH /api/positions/[id] — edit qty/avg, or add-to-position recompute. */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { id } = params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Invalid position id' }, { status: 400 });
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
  const position = await Position.findOne({ _id: id, userId });
  if (!position) {
    return NextResponse.json({ error: 'Position not found' }, { status: 404 });
  }

  const data = parsed.data;
  if ('mode' in data && data.mode === 'add') {
    const totalQty = position.quantity + data.addQuantity;
    const weighted =
      position.quantity * position.avgBuyPrice +
      data.addQuantity * data.addPrice;
    position.quantity = totalQty;
    position.avgBuyPrice = totalQty > 0 ? weighted / totalQty : 0;
  } else {
    if (data.quantity !== undefined) position.quantity = data.quantity;
    if (data.avgBuyPrice !== undefined) position.avgBuyPrice = data.avgBuyPrice;
  }

  await position.save();
  return NextResponse.json(serialize(position));
}

/** DELETE /api/positions/[id] — remove one of the current user's holdings. */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { id } = params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Invalid position id' }, { status: 400 });
  }

  await connectToDatabase();
  const result = await Position.deleteOne({ _id: id, userId });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: 'Position not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id });
}
