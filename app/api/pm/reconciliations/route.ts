// Reconciliation list + create (PDR §3.27a, BR-AC-17).
// GET ?bankAccountId=… returns the reconciliation history for that
// account (newest first). POST opens a new `In progress` reconciliation
// with the statement window + ending balance.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Reconciliation } from '@/lib/db/models/pm/Reconciliation';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const reconciliationCreateSchema = z.object({
  bankAccountId: objectIdString,
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  /** Dollars; route converts to cents. */
  statementEndingBalance: z.number(),
  notes: z.string().max(2000).optional(),
});

interface RecLeanLike {
  _id: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  status: string;
  startDate: Date;
  endDate: Date;
  statementEndingBalance: number;
  bookEndingBalance: number;
  difference: number;
  clearedLines: unknown[];
  completedAt?: Date | null;
  voidedAt?: Date | null;
  notes?: string;
  updatedAt: Date;
}

function serializeRec(r: RecLeanLike) {
  return {
    id: String(r._id),
    bankAccountId: String(r.bankAccountId),
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    statementEndingBalance: r.statementEndingBalance,
    bookEndingBalance: r.bookEndingBalance,
    difference: r.difference,
    clearedCount: r.clearedLines?.length ?? 0,
    completedAt: r.completedAt ?? null,
    voidedAt: r.voidedAt ?? null,
    notes: r.notes ?? '',
    updatedAt: r.updatedAt,
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const bankAccountId = searchParams.get('bankAccountId');

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (bankAccountId && Types.ObjectId.isValid(bankAccountId)) {
    filter.bankAccountId = new Types.ObjectId(bankAccountId);
  }

  const rows = await Reconciliation.find(filter)
    .sort({ endDate: -1 })
    .lean<RecLeanLike[]>();
  return NextResponse.json(rows.map(serializeRec));
}

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = reconciliationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  // Only one In-progress reconciliation per bank account at a time.
  const existing = await Reconciliation.findOne({
    organizationId: orgObjectId,
    bankAccountId: new Types.ObjectId(parsed.data.bankAccountId),
    status: 'In progress',
  }).lean<{ _id: Types.ObjectId } | null>();
  if (existing) {
    return NextResponse.json(
      {
        error:
          'An in-progress reconciliation already exists for this bank account. Resume or void it before starting a new one.',
        existingId: String(existing._id),
      },
      { status: 409 },
    );
  }

  try {
    const doc = await Reconciliation.create({
      organizationId: orgObjectId,
      bankAccountId: new Types.ObjectId(parsed.data.bankAccountId),
      status: 'In progress',
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      statementEndingBalance: toCents(parsed.data.statementEndingBalance),
      bookEndingBalance: 0,
      difference: 0,
      clearedLines: [],
      notes: parsed.data.notes,
      startedByUserId: new Types.ObjectId(ctx.userId),
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Reconciliation',
      parentId: doc._id,
      eventType: 'Reconciliation started',
      actorUserId: ctx.userId,
      payload: {
        bankAccountId: String(doc.bankAccountId),
        endDate: doc.endDate,
      },
    });

    return NextResponse.json(
      serializeRec(doc.toObject() as unknown as RecLeanLike),
      { status: 201 },
    );
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Failed to start reconciliation';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
