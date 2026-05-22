// WorkOrder CRUD (PDR §3.10). Every WO has a parent Task (BR-MV-5) —
// callers either pass `taskId` (existing Task) or `taskNew` (inline create).
// Both staff (`assignedToUserId`) AND vendor (`vendorId`) are required
// (BR-MV-6).
//
// The route validates polymorphic `chargeWorkTo` against the org and
// derives `propertyId` from the chosen target when type='Property' (BR-MV-10).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { WorkOrder } from '@/lib/db/models/pm/WorkOrder';
import { Task } from '@/lib/db/models/pm/Task';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import { Property } from '@/lib/db/models/pm/Property';
import { Lease } from '@/lib/db/models/pm/Lease';
import { RentalOwner } from '@/lib/db/models/pm/RentalOwner';
import { Unit } from '@/lib/db/models/pm/Unit';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { workOrderCreateSchema } from '@/lib/validation/pm/workOrder';
import { nextTaskId } from '@/lib/pm/taskIdSequence';
import { toCents } from '@/lib/pm/currency';
import { isPastDue } from '@/lib/pm/taskHelpers';
import { logActivity } from '@/lib/pm/activity';
import type { TaskStatus } from '@/types/pm';

export const runtime = 'nodejs';

interface WoLeanLike {
  _id: unknown;
  subject: string;
  vendorId: unknown;
  status: string;
  priority: string;
  dueDate?: Date | null;
  taskId: unknown;
  billTotal: number;
  billStatus: string;
  propertyId?: unknown;
  unitId?: unknown;
  updatedAt: Date;
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

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get('vendorId');
  const propertyId = searchParams.get('propertyId');
  const taskId = searchParams.get('taskId');
  const status = searchParams.get('status');
  const includeTerminal = searchParams.get('includeTerminal') === '1';
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeTerminal) {
    filter.status = { $nin: ['Completed', 'Cancelled'] };
  } else if (status) {
    filter.status = status;
  }
  if (vendorId && Types.ObjectId.isValid(vendorId)) {
    filter.vendorId = new Types.ObjectId(vendorId);
  }
  if (propertyId && Types.ObjectId.isValid(propertyId)) {
    filter.propertyId = new Types.ObjectId(propertyId);
  }
  if (taskId && Types.ObjectId.isValid(taskId)) {
    filter.taskId = new Types.ObjectId(taskId);
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.subject = rx;
  }

  const rows = await WorkOrder.find(filter)
    .sort({ updatedAt: -1 })
    .lean<WoLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      subject: r.subject,
      vendorId: String(r.vendorId),
      status: r.status,
      priority: r.priority,
      dueDate: r.dueDate ?? null,
      pastDue: isPastDue(
        r.dueDate ?? null,
        // WO status enum reuses the past-due gate; we treat
        // Completed/Cancelled as terminal via taskHelpers.
        r.status as unknown as TaskStatus,
      ),
      taskId: String(r.taskId),
      billTotal: r.billTotal,
      billStatus: r.billStatus,
      propertyId: r.propertyId ? String(r.propertyId) : null,
      unitId: r.unitId ? String(r.unitId) : null,
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

  const parsed = workOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  // BR-MV-6: vendor + staff existence checks.
  if (
    !(await Vendor.countDocuments({
      _id: new Types.ObjectId(parsed.data.vendorId),
      organizationId: orgObjectId,
      active: true,
    }))
  ) {
    return NextResponse.json(
      { error: 'vendorId does not reference an active vendor in this org' },
      { status: 400 },
    );
  }

  if (parsed.data.unitId && !Types.ObjectId.isValid(parsed.data.unitId)) {
    return NextResponse.json({ error: 'unitId invalid' }, { status: 400 });
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

  // Resolve or create the parent Task (BR-MV-5).
  let taskOid: Types.ObjectId;
  if (parsed.data.taskId) {
    const existing = await Task.findOne({
      _id: new Types.ObjectId(parsed.data.taskId),
      organizationId: orgObjectId,
    });
    if (!existing) {
      return NextResponse.json(
        { error: 'taskId does not reference a task in this org' },
        { status: 400 },
      );
    }
    taskOid = existing._id;
  } else if (parsed.data.taskNew) {
    const tNew = parsed.data.taskNew;
    const taskId = await nextTaskId(ctx.orgId);
    const t = await Task.create({
      organizationId: orgObjectId,
      taskId,
      title: tNew.title,
      taskType: tNew.taskType ?? 'To do',
      status: 'New',
      priority: tNew.priority ?? parsed.data.priority ?? 'Normal',
      dueDate: tNew.dueDate ? new Date(tNew.dueDate) : null,
      propertyId: tNew.propertyId
        ? new Types.ObjectId(tNew.propertyId)
        : null,
      unitId: tNew.unitId ? new Types.ObjectId(tNew.unitId) : null,
      vendors: [new Types.ObjectId(parsed.data.vendorId)],
      assignees: [new Types.ObjectId(parsed.data.assignedToUserId)],
      collaborators: (parsed.data.collaborators ?? []).map(
        (c) => new Types.ObjectId(c),
      ),
      description: tNew.description,
      workOrders: [],
      createdByUserId: new Types.ObjectId(ctx.userId),
    });
    taskOid = t._id;
  } else {
    return NextResponse.json(
      { error: 'taskId or taskNew is required (BR-MV-5).' },
      { status: 400 },
    );
  }

  // Derive propertyId: prefer explicit, then unit→property, then chargeWorkTo
  // when type=Property.
  let derivedPropertyId: Types.ObjectId | null = null;
  if (parsed.data.propertyId) {
    derivedPropertyId = new Types.ObjectId(parsed.data.propertyId);
  } else if (parsed.data.unitId) {
    const u = await Unit.findOne({
      _id: new Types.ObjectId(parsed.data.unitId),
      organizationId: orgObjectId,
    })
      .select('propertyId')
      .lean<{ propertyId: Types.ObjectId } | null>();
    if (u?.propertyId) derivedPropertyId = u.propertyId;
  } else if (parsed.data.chargeWorkTo?.type === 'Property') {
    derivedPropertyId = new Types.ObjectId(parsed.data.chargeWorkTo.id);
  }

  const wo = await WorkOrder.create({
    organizationId: orgObjectId,
    subject: parsed.data.subject,
    vendorId: new Types.ObjectId(parsed.data.vendorId),
    status: parsed.data.status ?? 'New',
    priority: parsed.data.priority ?? 'Normal',
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    taskId: taskOid,
    taskType: parsed.data.taskType,
    taskCategoryId: parsed.data.taskCategoryId
      ? new Types.ObjectId(parsed.data.taskCategoryId)
      : null,
    assignedToUserId: new Types.ObjectId(parsed.data.assignedToUserId),
    collaborators: (parsed.data.collaborators ?? []).map(
      (c) => new Types.ObjectId(c),
    ),
    workToBePerformed: parsed.data.workToBePerformed,
    vendorNotes: parsed.data.vendorNotes,
    entryDetails: parsed.data.entryDetails,
    entryContacts: (parsed.data.entryContacts ?? []).map(
      (t) => new Types.ObjectId(t),
    ),
    files: (parsed.data.files ?? []).map((f) => new Types.ObjectId(f)),
    invoiceNumber: parsed.data.invoiceNumber,
    chargeWorkTo: parsed.data.chargeWorkTo
      ? {
          type: parsed.data.chargeWorkTo.type,
          id: new Types.ObjectId(parsed.data.chargeWorkTo.id),
        }
      : null,
    partsAndLabor: (parsed.data.partsAndLabor ?? []).map((p) => ({
      qty: p.qty,
      accountId: new Types.ObjectId(p.accountId),
      description: p.description,
      price: toCents(p.price),
      total: Math.round(p.qty * toCents(p.price)),
    })),
    billStatus: 'No bills added',
    unitId: parsed.data.unitId
      ? new Types.ObjectId(parsed.data.unitId)
      : null,
    propertyId: derivedPropertyId,
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  // Back-link onto the Task.
  await Task.updateOne(
    { _id: taskOid },
    { $addToSet: { workOrders: wo._id } },
  );

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'WorkOrder',
    parentId: wo._id,
    eventType: 'Work order created',
    actorUserId: ctx.userId,
    payload: {
      subject: wo.subject,
      vendorId: String(wo.vendorId),
      taskId: String(taskOid),
    },
  });

  return NextResponse.json(
    { id: String(wo._id), taskId: String(taskOid) },
    { status: 201 },
  );
}
