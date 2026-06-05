// Single-position route — edit (PATCH) and delete (DELETE), always scoped to
// the owning userId so user A can never read or mutate user B's holdings even
// by guessing an id (PDR §12, IDOR defense). PATCH supports a direct edit and
// an "add to position" recompute mode (PDR §5.1).
// Refs: PDR.md §5.1, §5.3, §6 (Position), §11.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidObjectId, Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import { Company } from '@/lib/db/models/Company';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

// Optional "held-by" company. '' / null clears it; a value must be a 24-char
// hex ObjectId (ownership verified before storing). Omitted = no change.
const companyIdSchema = z
  .preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.union([z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid company'), z.null()]),
  )
  .optional();

// Direct edit: change quantity, avg buy price, and/or held-by company.
const replaceSchema = z
  .object({
    mode: z.literal('replace').optional(),
    quantity: z.number().positive('Quantity must be greater than 0').optional(),
    avgBuyPrice: z
      .number()
      .min(0, 'Average buy price cannot be negative')
      .optional(),
    companyId: companyIdSchema,
  })
  .refine(
    (d) =>
      d.quantity !== undefined ||
      d.avgBuyPrice !== undefined ||
      d.companyId !== undefined,
    { message: 'Provide quantity, avgBuyPrice, and/or companyId' },
  );

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
  companyId?: unknown;
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
    companyId: p.companyId ? String(p.companyId) : null,
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
    // Held-by: a value reassigns (after an ownership check), null clears it.
    if (data.companyId !== undefined) {
      if (data.companyId) {
        const owned = await Company.countDocuments({
          _id: data.companyId,
          userId,
        });
        if (owned === 0) {
          return NextResponse.json(
            { error: 'Invalid company' },
            { status: 400 },
          );
        }
      }
      position.companyId = data.companyId
        ? new Types.ObjectId(data.companyId)
        : null;
    }
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
