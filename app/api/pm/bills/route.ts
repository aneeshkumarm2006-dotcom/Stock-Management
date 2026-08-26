// Bill CRUD (PDR §3.21). POST: validate → optional lock-check → JE-post →
// back-link `journalEntryId` on the Bill. Draft Bills skip JE-posting until
// they transition out of Draft via PATCH.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Bill } from '@/lib/db/models/pm/Bill';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import { Property } from '@/lib/db/models/pm/Property';
import { CompanyAccount } from '@/lib/db/models/pm/CompanyAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { billCreateSchema } from '@/lib/validation/pm/bill';
import { toCents } from '@/lib/pm/currency';
import { scopeFromBillScope } from '@/lib/pm/scope';
import { logActivity } from '@/lib/pm/activity';
import {
  postBillToLedger,
  LockedPeriodError,
} from '@/lib/pm/postBillToLedger';

export const runtime = 'nodejs';

interface BillLeanLike {
  _id: unknown;
  vendorId?: unknown;
  invoiceDate: Date;
  status: string;
  refNo?: string;
  memo?: string;
  amount: number;
  scope?: { type: string; id?: unknown };
  workOrderId?: unknown;
  journalEntryId?: unknown;
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
    .sort({ invoiceDate: -1 })
    .lean<BillLeanLike[]>();

  // Resolve every scope id to a display name in two batched queries. The list
  // previously returned a bare `{type, id}`, so the page could only render the
  // vendor — and a bill with no vendor showed a literal "—" with nothing else
  // to identify it by. A recurring tax bill (no vendor, memo carrying the only
  // human label) was then genuinely unfindable in the UI. `memo` + `scopeName`
  // are what make a row recognisable, so both ship with the list.
  const propertyIds: Types.ObjectId[] = [];
  const companyIds: Types.ObjectId[] = [];
  for (const r of rows) {
    const id = r.scope?.id ? String(r.scope.id) : null;
    if (!id || !Types.ObjectId.isValid(id)) continue;
    if (r.scope?.type === 'Property') propertyIds.push(new Types.ObjectId(id));
    else companyIds.push(new Types.ObjectId(id));
  }
  const [props, companies] = await Promise.all([
    propertyIds.length
      ? Property.find(
          { organizationId: new Types.ObjectId(ctx.orgId), _id: { $in: propertyIds } },
          { _id: 1, propertyName: 1 },
        ).lean<Array<{ _id: Types.ObjectId; propertyName: string }>>()
      : [],
    companyIds.length
      ? CompanyAccount.find(
          { organizationId: new Types.ObjectId(ctx.orgId), _id: { $in: companyIds } },
          { _id: 1, name: 1 },
        ).lean<Array<{ _id: Types.ObjectId; name: string }>>()
      : [],
  ]);
  const nameById = new Map<string, string>([
    ...props.map((p) => [String(p._id), p.propertyName] as const),
    ...companies.map((c) => [String(c._id), c.name] as const),
  ]);

  return NextResponse.json(
    rows.map((r) => {
      const scopeId = r.scope?.id ? String(r.scope.id) : null;
      return {
        id: String(r._id),
        vendorId: r.vendorId ? String(r.vendorId) : null,
        invoiceDate: r.invoiceDate,
        status: r.status,
        refNo: r.refNo ?? '',
        memo: r.memo ?? '',
        amount: r.amount,
        scope: r.scope ? { type: r.scope.type, id: scopeId } : null,
        // Company-scoped rows written before companies were nameable carry a
        // null id and legitimately have no name — label them by scope type
        // rather than leaving the cell blank.
        scopeName:
          (scopeId ? nameById.get(scopeId) : null) ??
          (r.scope?.type === 'Property' ? 'Property' : 'Company'),
        workOrderId: r.workOrderId ? String(r.workOrderId) : null,
        journalEntryId: r.journalEntryId ? String(r.journalEntryId) : null,
        createdBy: r.createdBy,
        updatedAt: r.updatedAt,
      };
    }),
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
  // Symmetric check for a named company. A Company scope may still be `null`
  // (the org's own books), but when it names a CompanyAccount that row must
  // belong to this org — otherwise an id from another tenant would be stored
  // unvalidated and then stamped onto GL lines.
  if (parsed.data.scope?.type === 'Company' && parsed.data.scope.id) {
    const exists = await CompanyAccount.countDocuments({
      _id: new Types.ObjectId(parsed.data.scope.id),
      organizationId: orgObjectId,
    });
    if (!exists) {
      return NextResponse.json(
        { error: 'scope.id does not reference a company in this org' },
        { status: 400 },
      );
    }
  }

  const linesCents = parsed.data.lines.map((l) => ({
    accountId: new Types.ObjectId(l.accountId),
    description: l.description,
    amount: toCents(l.amount),
  }));

  const invoiceDate = new Date(parsed.data.invoiceDate);
  if (Number.isNaN(invoiceDate.getTime())) {
    return NextResponse.json({ error: 'Invalid invoiceDate' }, { status: 400 });
  }

  const status = parsed.data.status ?? 'Draft';
  const scope = parsed.data.scope ?? { type: 'Company' as const, id: null };

  // Build the Bill first so we have an _id for the JE memo + back-link.
  const bill = new Bill({
    organizationId: orgObjectId,
    vendorId: parsed.data.vendorId
      ? new Types.ObjectId(parsed.data.vendorId)
      : null,
    invoiceDate,
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
          invoiceDate,
          memo: parsed.data.memo,
          vendorId: bill.vendorId,
          // Full scope, so a bill recorded against a named company stamps that
          // company on its GL lines instead of a bare null.
          scope: scopeFromBillScope(scope),
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
