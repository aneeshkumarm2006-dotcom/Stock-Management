// Per-row CRUD on Unit. GET inflates the parent Property address (PDR §3.2 —
// `address` is derived from the parent property) and the last ActivityLogEntry
// for the `mostRecentEvent` field. `currentTenants` returns [] in Phase 1.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Unit } from '@/lib/db/models/pm/Unit';
import { Property } from '@/lib/db/models/pm/Property';
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
    // Phase 3 wiring once Lease + Tenant junction lands.
    currentTenants: [],
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
  // Units do not soft-archive — they're cheap data, and Phase 3 leases will
  // bind them. Phase 1 hard-deletes; if a Lease later FKs into a unit, the
  // delete will be blocked then.
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
