// Single-position route — edit (PATCH) and delete (DELETE), always scoped to
// the owning userId so user A can never read or mutate user B's holdings even
// by guessing an id (PDR §12, IDOR defense). PATCH supports a direct edit and
// an "add to position" recompute mode (PDR §5.1).
// Refs: PDR.md §5.1, §5.3, §6 (Position), §11.
import { NextResponse } from 'next/server';
import { isValidObjectId, Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import { Company } from '@/lib/db/models/Company';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  patchHoldingSchema,
  serializeHolding,
} from '@/lib/validation/holding';

export const runtime = 'nodejs';

// Which `replace` fields are applicable to each asset type. Fields outside the
// list are ignored even if sent, so a client can never, say, set a GIC's
// quantity. `companyId` (held-by) applies to every type.
const REPLACE_FIELDS: Record<string, readonly string[]> = {
  EQUITY: ['quantity', 'avgBuyPrice'],
  GIC: ['label', 'institution', 'principal', 'currency', 'startDate', 'maturityDate', 'interestRate', 'payoutFrequency'],
  BOND: ['label', 'institution', 'principal', 'currency', 'startDate', 'maturityDate', 'interestRate', 'payoutFrequency'],
  MUTUAL_FUND: ['label', 'currency', 'costBasis', 'currentValue', 'valueAsOf'],
  CASH: ['label', 'currency', 'currentValue'],
};

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

  const parsed = patchHoldingSchema.safeParse(body);
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

  const assetType = position.assetType ?? 'EQUITY';
  const data = parsed.data;

  if (data.mode === 'add') {
    // Equity-only: quantity-weighted average recompute.
    if (assetType !== 'EQUITY') {
      return NextResponse.json(
        { error: 'Add-to-position only applies to stocks/ETFs' },
        { status: 400 },
      );
    }
    const prevQty = position.quantity ?? 0;
    const prevAvg = position.avgBuyPrice ?? 0;
    const totalQty = prevQty + data.addQuantity;
    const weighted = prevQty * prevAvg + data.addQuantity * data.addPrice;
    position.quantity = totalQty;
    position.avgBuyPrice = totalQty > 0 ? weighted / totalQty : 0;
  } else if (data.mode === 'updateValue') {
    // One-tap monthly refresh for manually-valued holdings (fund/cash).
    if (assetType !== 'MUTUAL_FUND' && assetType !== 'CASH') {
      return NextResponse.json(
        { error: 'Value updates only apply to mutual funds and cash' },
        { status: 400 },
      );
    }
    position.currentValue = data.currentValue;
    position.valueAsOf = new Date();
  } else {
    // Replace: apply only the fields valid for this asset type.
    const allowed = REPLACE_FIELDS[assetType] ?? [];
    const fields = data as unknown as Record<string, unknown>;
    const target = position as unknown as Record<string, unknown>;
    for (const key of allowed) {
      const value = fields[key];
      if (value !== undefined) {
        target[key] = value;
      }
    }
    // Held-by applies to every type: a value reassigns (after an ownership
    // check), null clears it.
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
  return NextResponse.json(serializeHolding(position));
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
