// Bill CRUD (PDR §3.21). POST: validate → optional lock-check → JE-post →
// back-link `journalEntryId` on the Bill. Draft Bills skip JE-posting until
// they transition out of Draft via PATCH.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Bill } from '@/lib/db/models/pm/Bill';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import { Property } from '@/lib/db/models/pm/Property';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { billCreateSchema } from '@/lib/validation/pm/bill';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';
import {
  postBillToLedger,
  LockedPeriodError,
} from '@/lib/pm/postBillToLedger';

export const runtime = 'nodejs';

interface BillLeanLike {
  _id: unknown;
  vendorId?: unknown;
  dueDate: Date;
  status: string;
  refNo?: string;
  amount: number;
  scope?: { type: string; id?: unknown };
  workOrderId?: unknown;
  createdBy: string;
  updatedAt: Date;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const vendorId = searchParams.get('vendorId');
  const workOrderId = searchParams.get('workOrderId');
  const includeVoided = searchParams.get('includeVoided') === '1';

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeVoided) filter.status = { $ne: 'Voided' };
  if (status) filter.status = status;
  if (vendorId && Types.ObjectId.isValid(vendorId)) {
    filter.vendorId = new Types.ObjectId(vendorId);
  }
  if (workOrderId && Types.ObjectId.isValid(workOrderId)) {
    filter.workOrderId = new Types.ObjectId(workOrderId);
  }

  const rows = await Bill.find(filter)
    .sort({ dueDate: -1 })
    .lean<BillLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      vendorId: r.vendorId ? String(r.vendorId) : null,
      dueDate: r.dueDate,
      status: r.status,
      refNo: r.refNo ?? '',
      amount: r.amount,
      scope: r.scope
        ? { type: r.scope.type, id: r.scope.id ? String(r.scope.id) : null }
        : null,
      workOrderId: r.workOrderId ? String(r.workOrderId) : null,
      createdBy: r.createdBy,
      updatedAt: r.updatedAt,
    })),
  );
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

  const parsed = billCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  if (parsed.data.vendorId) {
    const exists = await Vendor.countDocuments({
      _id: new Types.ObjectId(parsed.data.vendorId),
      organizationId: orgObjectId,
    });
    if (!exists) {
      return NextResponse.json(
        { error: 'vendorId does not reference a vendor in this org' },
        { status: 400 },
      );
    }
  }
  if (parsed.data.scope?.type === 'Property' && parsed.data.scope.id) {
    const exists = await Property.countDocuments({
      _id: new Types.ObjectId(parsed.data.scope.id),
      organizationId: orgObjectId,
    });
    if (!exists) {
      return NextResponse.json(
        { error: 'scope.id does not reference a property in this org' },
        { status: 400 },
      );
    }
  }

  const linesCents = parsed.data.lines.map((l) => ({
    accountId: new Types.ObjectId(l.accountId),
    description: l.description,
    amount: toCents(l.amount),
  }));

  const dueDate = new Date(parsed.data.dueDate);
  if (Number.isNaN(dueDate.getTime())) {
    return NextResponse.json({ error: 'Invalid dueDate' }, { status: 400 });
  }

  const status = parsed.data.status ?? 'Draft';
  const scope = parsed.data.scope ?? { type: 'Company' as const, id: null };

  // Build the Bill first so we have an _id for the JE memo + back-link.
  const bill = new Bill({
    organizationId: orgObjectId,
    vendorId: parsed.data.vendorId
      ? new Types.ObjectId(parsed.data.vendorId)
      : null,
    dueDate,
    status,
    memo: parsed.data.memo,
    refNo: parsed.data.refNo,
    scope: {
      type: scope.type,
      id: scope.id ? new Types.ObjectId(scope.id) : null,
    },
    unitId: parsed.data.unitId ? new Types.ObjectId(parsed.data.unitId) : null,
    lines: linesCents,
    approverUserIds: (parsed.data.approverUserIds ?? []).map(
      (u) => new Types.ObjectId(u),
    ),
    attachmentFileId: parsed.data.attachmentFileId
      ? new Types.ObjectId(parsed.data.attachmentFileId)
      : null,
    workOrderId: parsed.data.workOrderId
      ? new Types.ObjectId(parsed.data.workOrderId)
      : null,
    createdBy: 'Manual',
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  if (status !== 'Draft') {
    try {
      const result = await postBillToLedger({
        orgId: ctx.orgId,
        ctx,
        bill: {
          _id: bill._id,
          dueDate,
          memo: parsed.data.memo,
          vendorId: bill.vendorId,
          scopePropertyId:
            scope.type === 'Property' && scope.id
              ? new Types.ObjectId(scope.id)
              : null,
          lines: linesCents,
          attachmentFileId: bill.attachmentFileId,
        },
      });
      bill.journalEntryId = result.journalEntryId;
      if (!['Draft', 'Voided'].includes(status)) {
        // No-op — status set above already; this branch left as a marker.
      }
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

  await bill.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Bill',
    parentId: bill._id,
    eventType: status === 'Draft' ? 'Bill drafted' : 'Bill posted',
    actorUserId: ctx.userId,
    payload: {
      amount: bill.amount,
      status: bill.status,
      journalEntryId: bill.journalEntryId ? String(bill.journalEntryId) : null,
    },
  });

  return NextResponse.json(
    {
      id: String(bill._id),
      journalEntryId: bill.journalEntryId ? String(bill.journalEntryId) : null,
    },
    { status: 201 },
  );
}
