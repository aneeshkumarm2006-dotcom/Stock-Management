// JournalEntry CRUD (PDR §3.19, BR-AC-1, BR-AC-3, BR-AC-14).
// GET supports filter chips on the GL page: ?accountId, ?propertyId, ?from,
// ?to, ?status, plus simple ?limit (default 100, max 500). Cursors deferred —
// MVP returns most-recent-first windowed by date.
//
// POST runs Zod → locked-period gate (per-property scoped) → save. The model
// pre('validate') hook performs the integer-cents balance check again so a
// malformed admin override still fails closed.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { journalEntryCreateSchema } from '@/lib/validation/pm/journalEntry';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import { serializeJournalEntry } from './serialize';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('accountId');
  const propertyId = searchParams.get('propertyId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const status = searchParams.get('status');
  const includeVoided = searchParams.get('includeVoided') === '1';
  const limitRaw = Number(searchParams.get('limit') ?? '100');
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (status) filter.status = status;
  else if (!includeVoided) filter.status = { $ne: 'Voided' };

  if (accountId && Types.ObjectId.isValid(accountId)) {
    filter['lines.accountId'] = new Types.ObjectId(accountId);
  }
  if (propertyId && Types.ObjectId.isValid(propertyId)) {
    filter['lines.scopeId'] = new Types.ObjectId(propertyId);
    filter['lines.scopeType'] = 'Property';
  }
  if (from || to) {
    const dateClause: Record<string, Date> = {};
    if (from) dateClause.$gte = new Date(from);
    if (to) dateClause.$lte = new Date(to);
    filter.date = dateClause;
  }

  const rows = await JournalEntry.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return NextResponse.json(rows.map((r) => serializeJournalEntry(r as Record<string, unknown>)));
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

  const parsed = journalEntryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const txnDate = new Date(parsed.data.date);
  if (Number.isNaN(txnDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  // BR-AC-3 — block writes inside locked periods, per affected Property scope.
  try {
    // Check entry-level scope first.
    if (parsed.data.scopeType === 'Property' && parsed.data.scopeId) {
      await assertWriteAllowed({
        orgId: ctx.orgId,
        txnDate,
        scopePropertyId: parsed.data.scopeId,
        ctx,
      });
    } else {
      await assertWriteAllowed({ orgId: ctx.orgId, txnDate, ctx });
    }
    // BR-AC-14 — each Property-scoped line might be locked independently.
    for (const line of parsed.data.lines) {
      if (line.scopeType === 'Property' && line.scopeId) {
        await assertWriteAllowed({
          orgId: ctx.orgId,
          txnDate,
          scopePropertyId: line.scopeId,
          ctx,
        });
      }
    }
  } catch (err) {
    if (err instanceof LockedPeriodError) {
      return NextResponse.json(
        { error: err.policyMessage, policyId: err.policyId },
        { status: 423 },
      );
    }
    throw err;
  }

  await connectToDatabase();

  try {
    const doc = await JournalEntry.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      date: txnDate,
      scopeType: parsed.data.scopeType,
      scopeId: parsed.data.scopeId ? new Types.ObjectId(parsed.data.scopeId) : null,
      memo: parsed.data.memo,
      attachmentFileId: parsed.data.attachmentFileId
        ? new Types.ObjectId(parsed.data.attachmentFileId)
        : null,
      lines: parsed.data.lines.map((l) => ({
        accountId: new Types.ObjectId(l.accountId),
        scopeType: l.scopeType,
        scopeId: l.scopeId ? new Types.ObjectId(l.scopeId) : null,
        unitId: l.unitId ? new Types.ObjectId(l.unitId) : null,
        name: l.name,
        description: l.description,
        debit: toCents(l.debit),
        credit: toCents(l.credit),
      })),
      status: parsed.data.status,
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'JournalEntry',
      parentId: doc._id,
      eventType:
        doc.status === 'Posted'
          ? 'JournalEntry posted'
          : 'JournalEntry created (Draft)',
      actorUserId: ctx.userId,
      payload: {
        totalDebits: doc.totalDebits,
        totalCredits: doc.totalCredits,
        lineCount: doc.lines.length,
      },
    });

    return NextResponse.json(
      serializeJournalEntry(doc.toObject() as unknown as Record<string, unknown>),
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save journal entry';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
