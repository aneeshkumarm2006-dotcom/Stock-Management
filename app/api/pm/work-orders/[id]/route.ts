// Per-row CRUD on WorkOrder (PDR §3.10). PATCH supports status flips,
// partsAndLabor edits (which recompute billTotal in pre('validate')), and
// chargeWorkTo retargeting.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { WorkOrder } from '@/lib/db/models/pm/WorkOrder';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import { Property } from '@/lib/db/models/pm/Property';
import { Lease } from '@/lib/db/models/pm/Lease';
import { RentalOwner } from '@/lib/db/models/pm/RentalOwner';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { workOrderUpdateSchema } from '@/lib/validation/pm/workOrder';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return WorkOrder.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

async function ensureChargeWorkToInOrg(
  target: { type: string; id: string },
  orgId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(target.id)) return false;
  const _id = new Types.ObjectId(target.id);
  const organizationId = new Types.ObjectId(orgId);
  if (target.type === 'Property') {
    return (await Property.countDocuments({ _id, organizationId })) > 0;
  }
  if (target.type === 'Lease') {
    return (await Lease.countDocuments({ _id, organizationId })) > 0;
  }
  if (target.type === 'RentalOwner') {
    return (await RentalOwner.countDocuments({ _id, organizationId })) > 0;
  }
  return false;
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
    subject: doc.subject,
    vendorId: String(doc.vendorId),
    status: doc.status,
    priority: doc.priority,
    dueDate: doc.dueDate ?? null,
    taskId: String(doc.taskId),
    taskType: doc.taskType ?? null,
    taskCategoryId: doc.taskCategoryId ? String(doc.taskCategoryId) : null,
    assignedToUserId: String(doc.assignedToUserId),
    collaborators: (doc.collaborators ?? []).map((c) => String(c)),
    workToBePerformed: doc.workToBePerformed ?? '',
    vendorNotes: doc.vendorNotes ?? '',
    entryDetails: doc.entryDetails ?? null,
    entryContacts: (doc.entryContacts ?? []).map((t) => String(t)),
    files: (doc.files ?? []).map((f) => String(f)),
    invoiceNumber: doc.invoiceNumber ?? '',
    chargeWorkTo: doc.chargeWorkTo
      ? { type: doc.chargeWorkTo.type, id: String(doc.chargeWorkTo.id) }
      : null,
    partsAndLabor: (doc.partsAndLabor ?? []).map((p) => ({
      qty: p.qty,
      accountId: String(p.accountId),
      description: p.description ?? '',
      price: p.price,
      total: p.total,
    })),
    billTotal: doc.billTotal,
    billStatus: doc.billStatus,
    unitId: doc.unitId ? String(doc.unitId) : null,
    propertyId: doc.propertyId ? String(doc.propertyId) : null,
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

  const parsed = workOrderUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (parsed.data.vendorId) {
    const ok = await Vendor.countDocuments({
      _id: new Types.ObjectId(parsed.data.vendorId),
      organizationId: new Types.ObjectId(ctx.orgId),
    });
    if (!ok) {
      return NextResponse.json(
        { error: 'vendorId does not reference a vendor in this org' },
        { status: 400 },
      );
    }
  }

  if (parsed.data.chargeWorkTo) {
    const ok = await ensureChargeWorkToInOrg(
      { type: parsed.data.chargeWorkTo.type, id: parsed.data.chargeWorkTo.id },
      ctx.orgId,
    );
    if (!ok) {
      return NextResponse.json(
        { error: 'chargeWorkTo target does not exist in this org' },
        { status: 400 },
      );
    }
  }

  const {
    dueDate,
    vendorId,
    assignedToUserId,
    collaborators,
    entryContacts,
    files,
    chargeWorkTo,
    partsAndLabor,
    unitId,
    propertyId,
    taskCategoryId,
    ...rest
  } = parsed.data;

  Object.assign(doc, rest);
  if (dueDate !== undefined) {
    doc.dueDate = dueDate ? new Date(dueDate) : null;
  }
  if (vendorId !== undefined) doc.vendorId = new Types.ObjectId(vendorId);
  if (assignedToUserId !== undefined) {
    doc.assignedToUserId = new Types.ObjectId(assignedToUserId);
  }
  if (collaborators !== undefined) {
    doc.collaborators = collaborators.map((c) => new Types.ObjectId(c));
  }
  if (entryContacts !== undefined) {
    doc.entryContacts = entryContacts.map((t) => new Types.ObjectId(t));
  }
  if (files !== undefined) {
    doc.files = files.map((f) => new Types.ObjectId(f));
  }
  if (chargeWorkTo !== undefined) {
    doc.chargeWorkTo = chargeWorkTo
      ? { type: chargeWorkTo.type, id: new Types.ObjectId(chargeWorkTo.id) }
      : null;
  }
  if (partsAndLabor !== undefined) {
    doc.partsAndLabor = partsAndLabor.map((p) => ({
      qty: p.qty,
      accountId: new Types.ObjectId(p.accountId),
      description: p.description,
      price: toCents(p.price),
      total: Math.round(p.qty * toCents(p.price)),
    }));
  }
  if (unitId !== undefined) {
    doc.unitId = unitId ? new Types.ObjectId(unitId) : null;
  }
  if (propertyId !== undefined) {
    doc.propertyId = propertyId ? new Types.ObjectId(propertyId) : null;
  }
  if (taskCategoryId !== undefined) {
    doc.taskCategoryId = taskCategoryId
      ? new Types.ObjectId(taskCategoryId)
      : null;
  }

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'WorkOrder',
    parentId: doc._id,
    eventType: 'Work order updated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Cancel rather than delete so the audit trail survives.
  doc.status = 'Cancelled';
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'WorkOrder',
    parentId: doc._id,
    eventType: 'Work order cancelled',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
