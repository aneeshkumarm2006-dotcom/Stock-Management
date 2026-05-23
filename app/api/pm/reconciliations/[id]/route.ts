// Reconciliation detail + mutate + delete (PDR §3.27a, BR-AC-17).
// GET returns the row + uncleared-line table for the wizard's Step 2.
// PATCH accepts incremental updates while In progress: append/remove
// cleared line refs, update notes, update statementEndingBalance.
// DELETE only works on In-progress rows (admin tool); Completed rows
// must be voided via the dedicated route.
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
import {
  computeUnclearedLines,
  computeBookEndingBalance,
} from '@/lib/pm/reconciliation';

export const runtime = 'nodejs';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const reconciliationUpdateSchema = z
  .object({
    statementEndingBalance: z.number().optional(),
    notes: z.string().max(2000).optional(),
    clearedLines: z
      .array(
        z.object({
          journalEntryId: objectIdString,
          lineId: objectIdString,
        }),
      )
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

async function loadDoc(orgId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Reconciliation.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await loadDoc(ctx.orgId, params.id);
  if (!doc) {
    return NextResponse.json(
      { error: 'Reconciliation not found' },
      { status: 404 },
    );
  }

  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const uncleared = await computeUnclearedLines({
    orgId: orgObjectId,
    bankAccountId: doc.bankAccountId,
    startDate: doc.startDate,
    endDate: doc.endDate,
  });
  const book = await computeBookEndingBalance({
    reconciliationId: doc._id,
    orgId: orgObjectId,
  });

  return NextResponse.json({
    id: String(doc._id),
    bankAccountId: String(doc.bankAccountId),
    status: doc.status,
    startDate: doc.startDate,
    endDate: doc.endDate,
    statementEndingBalance: doc.statementEndingBalance,
    bookEndingBalance: book,
    difference: doc.statementEndingBalance - book,
    notes: doc.notes ?? '',
    clearedLines: doc.clearedLines.map((c) => ({
      journalEntryId: String(c.journalEntryId),
      lineId: String(c.lineId),
    })),
    unclearedLines: uncleared,
    completedAt: doc.completedAt,
    voidedAt: doc.voidedAt,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = reconciliationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await loadDoc(ctx.orgId, params.id);
  if (!doc) {
    return NextResponse.json(
      { error: 'Reconciliation not found' },
      { status: 404 },
    );
  }
  if (doc.status !== 'In progress') {
    return NextResponse.json(
      { error: `Cannot edit a ${doc.status} reconciliation.` },
      { status: 409 },
    );
  }

  if (parsed.data.statementEndingBalance !== undefined) {
    doc.statementEndingBalance = toCents(parsed.data.statementEndingBalance);
  }
  if (parsed.data.notes !== undefined) doc.notes = parsed.data.notes;
  if (parsed.data.clearedLines !== undefined) {
    doc.clearedLines = parsed.data.clearedLines.map((c) => ({
      journalEntryId: new Types.ObjectId(c.journalEntryId),
      lineId: new Types.ObjectId(c.lineId),
    }));
  }

  await doc.save();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await loadDoc(ctx.orgId, params.id);
  if (!doc) {
    return NextResponse.json(
      { error: 'Reconciliation not found' },
      { status: 404 },
    );
  }
  if (doc.status !== 'In progress') {
    return NextResponse.json(
      {
        error:
          'Only In-progress reconciliations can be deleted; void Completed reconciliations via POST /void.',
      },
      { status: 409 },
    );
  }
  await Reconciliation.deleteOne({ _id: doc._id });
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Reconciliation',
    parentId: doc._id,
    eventType: 'Reconciliation discarded',
    actorUserId: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
