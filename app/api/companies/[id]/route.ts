// Single-company route — edit (PATCH: rename / set cash) and delete (DELETE),
// always scoped to the owning userId so user A can never read or mutate user
// B's company even by guessing an id (IDOR defense, mirrors
// app/api/positions/[id]/route.ts). Deletion is BLOCKED while any of the
// user's positions still point at the company — the user must reassign or
// clear those holdings (via the Edit panel "Held by" dropdown) first.
// Refs: PDR.md §6, §12.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Company } from '@/lib/db/models/Company';
import { Position } from '@/lib/db/models/Position';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Company name is required')
      .max(80, 'Company name is too long')
      .optional(),
    cashBalance: z
      .number()
      .min(0, 'Cash balance cannot be negative')
      .optional(),
    cashCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code')
      .optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.cashBalance !== undefined ||
      d.cashCurrency !== undefined,
    { message: 'Provide a name, cash balance, and/or currency' },
  );

function serialize(c: {
  _id: unknown;
  name: string;
  cashBalance: number;
  cashCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(c._id),
    name: c.name,
    cashBalance: c.cashBalance,
    cashCurrency: c.cashCurrency,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
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

/** PATCH /api/companies/[id] — rename and/or set the cash balance + currency. */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { id } = params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Invalid company id' }, { status: 400 });
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
  const company = await Company.findOne({ _id: id, userId });
  if (!company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  const data = parsed.data;
  if (data.name !== undefined) company.name = data.name;
  if (data.cashBalance !== undefined) company.cashBalance = data.cashBalance;
  if (data.cashCurrency !== undefined) company.cashCurrency = data.cashCurrency;

  try {
    await company.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return NextResponse.json(
        { error: 'A company with that name already exists' },
        { status: 409 },
      );
    }
    throw err;
  }

  const positionCount = await Position.countDocuments({
    userId,
    companyId: id,
  });
  return NextResponse.json({ ...serialize(company), positionCount });
}

/** DELETE /api/companies/[id] — remove a company (blocked while in use). */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { id } = params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Invalid company id' }, { status: 400 });
  }

  await connectToDatabase();

  // Block-while-in-use: a company that still owns holdings cannot be deleted.
  // The user reassigns or clears those positions first (Edit panel dropdown).
  const positionCount = await Position.countDocuments({ userId, companyId: id });
  if (positionCount > 0) {
    return NextResponse.json(
      {
        error: `This company still holds ${positionCount} ${
          positionCount === 1 ? 'holding' : 'holdings'
        }. Reassign or clear them before deleting.`,
        positionCount,
      },
      { status: 409 },
    );
  }

  const result = await Company.deleteOne({ _id: id, userId });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id });
}
