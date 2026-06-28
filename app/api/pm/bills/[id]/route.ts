// Per-row CRUD on Bill (PDR §3.21). PATCH supports status flips (Draft →
// Due, Due → Paid, etc.) and limited field edits. When a Draft transitions
// to a posted status the route invokes postBillToLedger.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Bill } from '@/lib/db/models/pm/Bill';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { billUpdateSchema } from '@/lib/validation/pm/bill';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';
import {
  postBillToLedger,
  LockedPeriodError,
} from '@/lib/pm/postBillToLedger';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { BillPayment } from '@/lib/db/models/pm/BillPayment';
import { reverseJournalEntry } from '@/lib/pm/reverseJournalEntry';
import { repostBillJournalEntry } from '@/lib/pm/repostBillJournalEntry';
import { assertWriteAllowed } from '@/lib/pm/lockedPeriod';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Bill.findOne({
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
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    id: String(doc._id),
    vendorId: doc.vendorId ? String(doc.vendorId) : null,
    invoiceDate: doc.invoiceDate,
    status: doc.status,
    memo: doc.memo ?? '',
    refNo: doc.refNo ?? '',
    amount: doc.amount,
    scope: doc.scope
      ? { type: doc.scope.type, id: doc.scope.id ? String(doc.scope.id) : null }
      : null,
    unitId: doc.unitId ? String(doc.unitId) : null,
    lines: (doc.lines ?? []).map((l) => ({
      accountId: String(l.accountId),
      description: l.description ?? '',
      amount: l.amount,
    })),
    paidDate: doc.paidDate ?? null,
    approverUserIds: (doc.approverUserIds ?? []).map((u) => String(u)),
    journalEntryId: doc.journalEntryId ? String(doc.journalEntryId) : null,
    attachmentFileId: doc.attachmentFileId ? String(doc.attachmentFileId) : null,
    createdBy: doc.createdBy,
    workOrderId: doc.workOrderId ? String(doc.workOrderId) : null,
    updatedAt: doc.updatedAt,
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

  const parsed = billUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Immutability rules: once Voided, no edits.
  if (doc.status === 'Voided') {
    return NextResponse.json(
      { error: 'Cannot edit a voided bill.' },
      { status: 409 },
    );
  }

  const wasDraft = doc.status === 'Draft';

  // Snapshot the JE-affecting fields BEFORE mutating the doc, so we can tell
  // whether a *posted* bill's edit is financially material (lines/scope/date/
  // memo all land on the accrual JE) and therefore needs a reverse + re-post.
  const before = {
    // Compared at calendar-day granularity: clients submit a bare YYYY-MM-DD as
    // midnight UTC, but a stored date may be noon-anchored (InlineFieldEditor),
    // so an exact-instant compare would flag a no-op edit as a date change.
    invoiceDay: doc.invoiceDate
      ? doc.invoiceDate.toISOString().slice(0, 10)
      : '',
    memo: doc.memo ?? '',
    scopeType: doc.scope?.type ?? 'Company',
    scopeId: doc.scope?.id ? String(doc.scope.id) : null,
    lines: (doc.lines ?? []).map((l) => ({
      accountId: String(l.accountId),
      amount: l.amount,
      description: l.description ?? '',
    })),
  };

  const {
    invoiceDate,
    vendorId,
    scope,
    unitId,
    lines,
    approverUserIds,
    attachmentFileId,
    workOrderId,
    status,
    ...rest
  } = parsed.data;
  Object.assign(doc, rest);
  if (invoiceDate !== undefined) doc.invoiceDate = new Date(invoiceDate);
  if (vendorId !== undefined) {
    doc.vendorId = vendorId ? new Types.ObjectId(vendorId) : null;
  }
  if (scope !== undefined) {
    doc.scope = {
      type: scope.type,
      id: scope.id ? new Types.ObjectId(scope.id) : null,
    };
  }
  if (unitId !== undefined) {
    doc.unitId = unitId ? new Types.ObjectId(unitId) : null;
  }
  if (lines !== undefined) {
    doc.lines = lines.map((l) => ({
      accountId: new Types.ObjectId(l.accountId),
      description: l.description,
      amount: toCents(l.amount),
    }));
  }
  if (approverUserIds !== undefined) {
    doc.approverUserIds = approverUserIds.map((u) => new Types.ObjectId(u));
  }
  if (attachmentFileId !== undefined) {
    doc.attachmentFileId = attachmentFileId
      ? new Types.ObjectId(attachmentFileId)
      : null;
  }
  if (workOrderId !== undefined) {
    doc.workOrderId = workOrderId ? new Types.ObjectId(workOrderId) : null;
  }
  if (status !== undefined) doc.status = status as typeof doc.status;

  // Draft → Due (or any posted status) triggers JE posting.
  if (wasDraft && doc.status !== 'Draft' && !doc.journalEntryId) {
    try {
      const result = await postBillToLedger({
        orgId: ctx.orgId,
        ctx,
        bill: {
          _id: doc._id,
          invoiceDate: doc.invoiceDate,
          memo: doc.memo,
          vendorId: doc.vendorId,
          scopePropertyId:
            doc.scope?.type === 'Property' && doc.scope.id ? doc.scope.id : null,
          lines: doc.lines,
          attachmentFileId: doc.attachmentFileId,
        },
      });
      doc.journalEntryId = result.journalEntryId;
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        return NextResponse.json(
          { error: err.policyMessage, policyId: err.policyId },
          { status: 423 },
        );
      }
      const msg = err instanceof Error ? err.message : 'Failed to post bill';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  // A posted bill (Due/Overdue/Partially paid/Paid) already has an accrual JE.
  // When a financially-material field changes we UPDATE that JE in place so the
  // ledger keeps matching the bill WITHOUT leaving a void + reversal pair in the
  // GL (which previously cancelled the bill out of the Financials). A PATCH that
  // flips status to Voided is a void, not an edit — skip re-posting.
  const isPosted = !wasDraft && status !== 'Voided';

  const afterLines = (doc.lines ?? []).map((l) => ({
    accountId: String(l.accountId),
    amount: l.amount,
    description: l.description ?? '',
  }));
  const linesChanged =
    lines !== undefined &&
    (afterLines.length !== before.lines.length ||
      afterLines.some(
        (l, i) =>
          l.accountId !== before.lines[i]!.accountId ||
          l.amount !== before.lines[i]!.amount ||
          l.description !== before.lines[i]!.description,
      ));
  const invoiceDateChanged =
    invoiceDate !== undefined &&
    doc.invoiceDate.toISOString().slice(0, 10) !== before.invoiceDay;
  const memoChanged =
    parsed.data.memo !== undefined && (doc.memo ?? '') !== before.memo;
  const scopeChanged =
    scope !== undefined &&
    ((doc.scope?.type ?? 'Company') !== before.scopeType ||
      (doc.scope?.id ? String(doc.scope.id) : null) !== before.scopeId);
  const materialChanged =
    linesChanged || invoiceDateChanged || memoChanged || scopeChanged;

  let reposted = false;
  let repostPayload: Record<string, unknown> | undefined;

  if (isPosted && materialChanged) {
    // A bill with applied payments has separate, immutable payment JEs we can't
    // keep consistent by re-posting the accrual. Force void-the-payments-first.
    const paymentCount = await BillPayment.countDocuments({
      organizationId: new Types.ObjectId(ctx.orgId),
      billId: doc._id,
    });
    if (paymentCount > 0) {
      return NextResponse.json(
        {
          error:
            'This bill has payments applied. Void the payments before editing amounts, dates, scope, or memo.',
        },
        { status: 409 },
      );
    }

    const oldJe = doc.journalEntryId
      ? await JournalEntry.findOne({
          _id: doc.journalEntryId,
          organizationId: new Types.ObjectId(ctx.orgId),
        })
      : null;
    const newScopePropertyId =
      doc.scope?.type === 'Property' && doc.scope.id
        ? String(doc.scope.id)
        : null;

    // Lock-gate BOTH the old JE's date (the reversal) and the new invoiceDate
    // (the re-post) up front, before any write, so a lock failure leaves
    // nothing half-written.
    try {
      if (oldJe && oldJe.status === 'Posted') {
        await assertWriteAllowed({
          orgId: ctx.orgId,
          txnDate: oldJe.date,
          scopePropertyId:
            oldJe.scopeType === 'Property' && oldJe.scopeId
              ? String(oldJe.scopeId)
              : null,
          ctx,
        });
      }
      await assertWriteAllowed({
        orgId: ctx.orgId,
        txnDate: doc.invoiceDate,
        scopePropertyId: newScopePropertyId,
        ctx,
      });
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        return NextResponse.json(
          { error: err.policyMessage, policyId: err.policyId },
          { status: 423 },
        );
      }
      throw err;
    }

    try {
      const result = await repostBillJournalEntry({
        orgId: ctx.orgId,
        ctx,
        existingJe: oldJe,
        bill: {
          _id: doc._id,
          invoiceDate: doc.invoiceDate,
          memo: doc.memo,
          vendorId: doc.vendorId,
          scopePropertyId: newScopePropertyId,
          lines: doc.lines, // already cents
          attachmentFileId: doc.attachmentFileId,
        },
      });
      repostPayload = {
        journalEntryId: String(result.journalEntryId),
        updatedInPlace: oldJe?.status === 'Posted',
      };
      doc.journalEntryId = result.journalEntryId;
      reposted = true;
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        return NextResponse.json(
          { error: err.policyMessage, policyId: err.policyId },
          { status: 423 },
        );
      }
      const msg = err instanceof Error ? err.message : 'Failed to re-post bill';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Bill',
    parentId: doc._id,
    eventType: reposted
      ? 'Bill re-posted'
      : wasDraft && doc.status !== 'Draft'
        ? 'Bill posted'
        : 'Bill updated',
    actorUserId: ctx.userId,
    payload: repostPayload,
  });

  return NextResponse.json({
    ok: true,
    journalEntryId: doc.journalEntryId ? String(doc.journalEntryId) : null,
  });
}

// DELETE /api/pm/bills/[id]?mode=hard|void — remove a bill (default: hard).
//   hard → permanently delete the bill AND its accrual JE so nothing remains in
//          the GL or Financials (only a "Bill deleted" activity-log line stays).
//   void → keep the bill as Voided and write a reversing JE (full audit trail,
//          leaves a reversal row in the GL).
// Both modes block when the bill has payments (409) and respect the
// locked-period gate (423) on the JE date.
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const mode =
    new URL(request.url).searchParams.get('mode') === 'void' ? 'void' : 'hard';

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.status === 'Voided') {
    return NextResponse.json(
      { error: 'Bill is already voided.' },
      { status: 409 },
    );
  }

  // A bill with applied payments has separate, immutable payment JEs we can't
  // keep consistent — force void-the-payments-first (same guard as the edit path).
  const paymentCount = await BillPayment.countDocuments({
    organizationId: new Types.ObjectId(ctx.orgId),
    billId: doc._id,
  });
  if (paymentCount > 0) {
    return NextResponse.json(
      {
        error:
          'This bill has payments applied. Void the payments before deleting the bill.',
      },
      { status: 409 },
    );
  }

  const je = doc.journalEntryId
    ? await JournalEntry.findOne({
        _id: doc.journalEntryId,
        organizationId: new Types.ObjectId(ctx.orgId),
      })
    : null;

  const scopePropertyId =
    je && je.scopeType === 'Property' && je.scopeId
      ? String(je.scopeId)
      : doc.scope?.type === 'Property' && doc.scope.id
        ? String(doc.scope.id)
        : null;

  // Lock-period gate on the entry's date before any write.
  try {
    await assertWriteAllowed({
      orgId: ctx.orgId,
      txnDate: je?.date ?? doc.invoiceDate,
      scopePropertyId,
      ctx,
    });
  } catch (err) {
    if (err instanceof LockedPeriodError) {
      return NextResponse.json(
        { error: err.policyMessage, policyId: err.policyId },
        { status: 423 },
      );
    }
    throw err;
  }

  if (mode === 'void') {
    let reversalId: Types.ObjectId | null = null;
    if (je && je.status === 'Posted') {
      const { reversal } = await reverseJournalEntry({
        je,
        ctx,
        memo: `Reversal of bill ${String(doc._id)}`,
      });
      reversalId = reversal._id;
    }
    doc.status = 'Voided';
    doc.voidingJournalEntryId = reversalId;
    doc.voidedAt = new Date();
    doc.voidedByUserId = new Types.ObjectId(ctx.userId);
    await doc.save();

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Bill',
      parentId: doc._id,
      eventType: 'Bill voided',
      actorUserId: ctx.userId,
      payload: {
        reversalJournalEntryId: reversalId ? String(reversalId) : null,
      },
    });

    return NextResponse.json({ ok: true, mode: 'void' });
  }

  // mode === 'hard' — permanently remove the bill and its accrual JE.
  const hardDeletedJournalEntryId = je ? String(je._id) : null;
  const amountCents = doc.amount;
  const billId = doc._id;
  if (je) await je.deleteOne();
  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Bill',
    parentId: billId,
    eventType: 'Bill deleted',
    actorUserId: ctx.userId,
    payload: { hardDeletedJournalEntryId, amountCents },
  });

  return NextResponse.json({ ok: true, mode: 'hard' });
}
