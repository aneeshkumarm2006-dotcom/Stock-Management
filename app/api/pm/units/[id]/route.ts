// Per-row CRUD on Unit. GET inflates the parent Property address (PDR §3.2 —
// `address` is derived from the parent property), the last ActivityLogEntry
// for the `mostRecentEvent` field, and (Phase 3) `currentTenants` from the
// Active lease on the unit, plus a small `activeLease` summary so the UI
// can decide whether to surface "occupied" badges.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Unit } from '@/lib/db/models/pm/Unit';
import { Property } from '@/lib/db/models/pm/Property';
import { Lease } from '@/lib/db/models/pm/Lease';
import { ActivityLogEntry } from '@/lib/db/models/pm/ActivityLogEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { unitUpdateSchema } from '@/lib/validation/pm/unit';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Unit.findOne({
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

  const property = await Property.findOne({
    _id: doc.propertyId,
    organizationId: doc.organizationId,
  })
    .select({ propertyName: 1, address: 1 })
    .lean();

  const lastEvent = await ActivityLogEntry.findOne({
    organizationId: doc.organizationId,
    parentType: 'Unit',
    parentId: doc._id,
  })
    .sort({ createdAt: -1 })
    .lean();

  // Phase 3 — derive `currentTenants` from the Active lease on this unit.
  // BR-LL-2 allows Future + Active to coexist; we surface only Active here
  // because tenants haven't moved in on Future leases yet.
  const activeLease = await Lease.findOne({
    organizationId: doc.organizationId,
    unitId: doc._id,
    status: 'Active',
  })
    .select({
      _id: 1,
      leaseNumber: 1,
      tenants: 1,
      startDate: 1,
      endDate: 1,
      leaseType: 1,
    })
    .lean();
  const currentTenants =
    activeLease?.tenants?.map((t) => ({
      tenantId: String(t.tenantId),
      firstName: t.firstName,
      lastName: t.lastName,
      isCosigner: t.isCosigner,
    })) ?? [];

  return NextResponse.json({
    id: String(doc._id),
    propertyId: String(doc.propertyId),
    propertyName: property?.propertyName ?? '(unknown)',
    address: property?.address ?? null,
    unitId: doc.unitId,
    bedrooms: doc.bedrooms ?? null,
    bathrooms: doc.bathrooms ?? '',
    sizeSqft: doc.sizeSqft ?? null,
    description: doc.description ?? '',
    amenities: doc.amenities ?? [],
    currentTenants,
    activeLease: activeLease
      ? {
          id: String(activeLease._id),
          leaseNumber: activeLease.leaseNumber,
          leaseType: activeLease.leaseType,
          startDate: activeLease.startDate,
          endDate: activeLease.endDate ?? null,
        }
      : null,
    mostRecentEvent: lastEvent
      ? {
          eventType: lastEvent.eventType,
          createdAt: lastEvent.createdAt,
        }
      : null,
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

  const parsed = unitUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  Object.assign(doc, parsed.data);
  try {
    await doc.save();
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: 'A unit with this ID already exists on this property' },
        { status: 409 },
      );
    }
    throw err;
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Unit',
    parentId: doc._id,
    eventType: 'Unit updated',
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
  // Phase 3 — block delete when an Active or Future lease references the
  // unit. Past/Ended/Cancelled leases keep their historical reference but
  // do not block.
  const blockingLease = await Lease.findOne({
    organizationId: doc.organizationId,
    unitId: doc._id,
    status: { $in: ['Active', 'Future'] },
  })
    .select({ _id: 1, leaseNumber: 1, status: 1 })
    .lean<{ _id: Types.ObjectId; leaseNumber: number; status: string } | null>();
  if (blockingLease) {
    return NextResponse.json(
      {
        error: `Unit is bound to lease #${blockingLease.leaseNumber} (${blockingLease.status}); end or cancel the lease first.`,
      },
      { status: 409 },
    );
  }
  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Unit',
    parentId: doc._id,
    eventType: 'Unit deleted',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
