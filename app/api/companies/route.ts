// Companies collection route — list (GET) and create (POST) the signed-in
// user's holding companies. A company is the optional "held-by" owner of a
// position and a place to log uninvested cash. Every query is scoped to the
// session-derived userId; the client-supplied id is never trusted (IDOR
// defense, mirrors app/api/positions/route.ts).
// Refs: PDR.md §6, §9, §12.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Company } from '@/lib/db/models/Company';
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
    .min(1, 'Company name is required')
    .max(80, 'Company name is too long'),
  cashBalance: z.number().min(0, 'Cash balance cannot be negative').optional(),
  cashCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code')
    .optional(),
});

/**
 * GET /api/companies — the user's companies, each with a `positionCount` of
 * how many holdings currently point at it (used by the Manage page to gate
 * deletion — a company with holdings cannot be deleted).
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  await connectToDatabase();
  const companies = await Company.find({ userId }).sort({ name: 1 }).lean();

  // One aggregation for the held-by counts. NOTE: aggregation `$match` does
  // not auto-cast like a query, so userId must be a real ObjectId here.
  const counts = await Position.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { userId: new Types.ObjectId(userId), companyId: { $ne: null } } },
    { $group: { _id: '$companyId', count: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map((c) => [String(c._id), c.count]));

  return NextResponse.json({
    companies: companies.map((c) => ({
      id: String(c._id),
      name: c.name,
      cashBalance: c.cashBalance ?? 0,
      cashCurrency: c.cashCurrency ?? 'USD',
      positionCount: countById.get(String(c._id)) ?? 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}

/** POST /api/companies — create a company for the current user. */
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

  const { name, cashBalance, cashCurrency } = parsed.data;

  await connectToDatabase();
  try {
    const created = await Company.create({
      userId,
      name,
      cashBalance: cashBalance ?? 0,
      cashCurrency: cashCurrency ?? 'USD',
    });
    return NextResponse.json(
      {
        id: String(created._id),
        name: created.name,
        cashBalance: created.cashBalance,
        cashCurrency: created.cashCurrency,
        positionCount: 0,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return NextResponse.json(
        { error: 'A company with that name already exists' },
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
