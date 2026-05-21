// Appliance CRUD (PDR_MASTER §3.30). List scoping:
//   ?unitId=...      → all appliances on that unit
//   ?propertyId=...  → all appliances on all units of that property (rollup)
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Appliance } from '@/lib/db/models/pm/Appliance';
import { Unit } from '@/lib/db/models/pm/Unit';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { applianceCreateSchema } from '@/lib/validation/pm/appliance';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface ApplianceLeanLike {
  _id: unknown;
  name: string;
  installedDate?: Date | null;
  unitId: unknown;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const unitId = searchParams.get('unitId');
  const propertyId = searchParams.get('propertyId');

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);

  let unitFilter: Types.ObjectId[] = [];
  if (unitId && Types.ObjectId.isValid(unitId)) {
    unitFilter = [new Types.ObjectId(unitId)];
  } else if (propertyId && Types.ObjectId.isValid(propertyId)) {
    const propertyUnits = await Unit.find({
      organizationId: orgId,
      propertyId: new Types.ObjectId(propertyId),
    })
      .select({ _id: 1, unitId: 1 })
      .lean();
    unitFilter = propertyUnits.map((u) => u._id as Types.ObjectId);
  } else {
    return NextResponse.json(
      { error: 'unitId or propertyId query required' },
      { status: 400 },
    );
  }

  if (unitFilter.length === 0) {
    return NextResponse.json([]);
  }

  const [appliances, units] = await Promise.all([
    Appliance.find({
      organizationId: orgId,
      unitId: { $in: unitFilter },
    })
      .sort({ name: 1 })
      .lean<ApplianceLeanLike[]>(),
    Unit.find({
      organizationId: orgId,
      _id: { $in: unitFilter },
    })
      .select({ unitId: 1 })
      .lean<Array<{ _id: unknown; unitId: string }>>(),
  ]);

  const unitNumberById = new Map<string, string>();
  for (const u of units) unitNumberById.set(String(u._id), u.unitId);

  return NextResponse.json(
    appliances.map((a) => ({
      id: String(a._id),
      name: a.name,
      installedDate: a.installedDate ?? null,
      unitId: String(a.unitId),
      unitNumber: unitNumberById.get(String(a.unitId)) ?? '(unknown)',
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

  const parsed = applianceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const unitObjectId = new Types.ObjectId(parsed.data.unitId);

  const unit = await Unit.findOne({
    _id: unitObjectId,
    organizationId: orgId,
  })
    .select({ _id: 1 })
    .lean();
  if (!unit) {
    return NextResponse.json(
      { error: 'unitId does not reference a unit in this org' },
      { status: 400 },
    );
  }

  const doc = await Appliance.create({
    organizationId: orgId,
    unitId: unitObjectId,
    name: parsed.data.name,
    installedDate: parsed.data.installedDate
      ? new Date(parsed.data.installedDate)
      : null,
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Unit',
    parentId: unitObjectId,
    eventType: 'Appliance added',
    actorUserId: ctx.userId,
    payload: { name: doc.name, applianceId: String(doc._id) },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
