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
    dueDate: doc.dueDate,
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

  const {
    dueDate,
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
  if (dueDate !== undefined) doc.dueDate = new Date(dueDate);
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
          dueDate: doc.dueDate,
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

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Bill',
    parentId: doc._id,
    eventType: wasDraft && doc.status !== 'Draft' ? 'Bill posted' : 'Bill updated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({
    ok: true,
    journalEntryId: doc.journalEntryId ? String(doc.journalEntryId) : null,
  });
}
