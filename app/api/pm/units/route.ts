// Unit CRUD (PDR_MASTER §3.2). List is always scoped by `?propertyId=...`
// (units don't live in a flat list view). Each row carries an `applianceCount`
// roll-up so the Property → Units tab can render counts without a second
// fetch per row.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Unit } from '@/lib/db/models/pm/Unit';
import { Property } from '@/lib/db/models/pm/Property';
import { Appliance } from '@/lib/db/models/pm/Appliance';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { unitCreateSchema } from '@/lib/validation/pm/unit';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface UnitLeanLike {
  _id: unknown;
  unitId: string;
  bedrooms?: number;
  bathrooms?: string;
  sizeSqft?: number;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get('propertyId');
  if (!propertyId || !Types.ObjectId.isValid(propertyId)) {
    return NextResponse.json(
      { error: 'propertyId query required' },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const propertyObjectId = new Types.ObjectId(propertyId);

  const rows = await Unit.find({
    organizationId: orgId,
    propertyId: propertyObjectId,
  })
    .sort({ unitId: 1 })
    .lean<UnitLeanLike[]>();

  // Bulk-count appliances per unit in one aggregate.
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const unitIds = rows.map((u) => u._id) as Types.ObjectId[];
    const agg = await Appliance.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { organizationId: orgId, unitId: { $in: unitIds } } },
      { $group: { _id: '$unitId', count: { $sum: 1 } } },
    ]);
    for (const row of agg) counts.set(String(row._id), row.count);
  }

  return NextResponse.json(
    rows.map((u) => ({
      id: String(u._id),
      unitId: u.unitId,
      bedrooms: u.bedrooms ?? null,
      bathrooms: u.bathrooms ?? '',
      sizeSqft: u.sizeSqft ?? null,
      applianceCount: counts.get(String(u._id)) ?? 0,
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

  const parsed = unitCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);

  // Property FK must exist in this org.
  const property = await Property.findOne({
    _id: new Types.ObjectId(parsed.data.propertyId),
    organizationId: orgId,
  })
    .select({ _id: 1 })
    .lean();
  if (!property) {
    return NextResponse.json(
      { error: 'propertyId does not reference a property in this org' },
      { status: 400 },
    );
  }

  try {
    const doc = await Unit.create({
      organizationId: orgId,
      propertyId: property._id,
      unitId: parsed.data.unitId,
      bedrooms: parsed.data.bedrooms,
      bathrooms: parsed.data.bathrooms,
      sizeSqft: parsed.data.sizeSqft,
      description: parsed.data.description,
      amenities: parsed.data.amenities ?? [],
      images: (parsed.data.images ?? []).map((id) => new Types.ObjectId(id)),
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Unit',
      parentId: doc._id,
      eventType: 'Unit created',
      actorUserId: ctx.userId,
      payload: { unitId: doc.unitId, propertyId: String(property._id) },
    });

    return NextResponse.json({ id: String(doc._id) }, { status: 201 });
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
}
