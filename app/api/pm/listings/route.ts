// Listing CRUD (PDR §3.8). One Listing per Unit (enforced by the model's
// unique index). BR-LA-1: a Unit must be Unlisted before listing; we re-check
// occupancy on POST when `listed=true` (the list-toggle route handles the
// runtime flip).
import { NextResponse } from 'next/server';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Listing } from '@/lib/db/models/pm/Listing';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { listingCreateSchema } from '@/lib/validation/pm/listing';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';

export const runtime = 'nodejs';

interface PropertyRollupRow {
  _id: unknown;
  propertyName: string;
  address?: Record<string, unknown>;
}
interface UnitRow {
  _id: unknown;
  propertyId: unknown;
  unitId?: string;
}

async function fetchPropertyRollups(
  orgId: Types.ObjectId,
  propertyIds: Types.ObjectId[],
): Promise<Map<string, PropertyRollupRow>> {
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1 || !conn.db || propertyIds.length === 0) {
    return new Map();
  }
  const rows = (await conn.db
    .collection('pm_properties')
    .find({ organizationId: orgId, _id: { $in: propertyIds } })
    .project({ propertyName: 1, address: 1 })
    .toArray()) as unknown as PropertyRollupRow[];
  return new Map(rows.map((r) => [String(r._id), r]));
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const listedParam = searchParams.get('listed');
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (listedParam === 'true') filter.listed = true;
  else if (listedParam === 'false') filter.listed = false;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { unitDescription: rx },
      { contactName: rx },
      { contactEmail: rx },
      { leaseTermsBlurb: rx },
    ];
  }

  const rows = await Listing.find(filter)
    .sort({ updatedAt: -1 })
    .lean();

  const propertyIds = rows.map(
    (r) => r.propertyId as unknown as Types.ObjectId,
  );
  const props = await fetchPropertyRollups(
    new Types.ObjectId(ctx.orgId),
    propertyIds,
  );

  return NextResponse.json(
    rows.map((r) => {
      const prop = props.get(String(r.propertyId));
      const listedDate = r.listedDate ? new Date(r.listedDate) : null;
      const daysListed =
        listedDate
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - listedDate.getTime()) / (24 * 60 * 60 * 1000),
              ),
            )
          : null;
      return {
        id: String(r._id),
        unitId: String(r.unitId),
        propertyId: String(r.propertyId),
        propertyName: prop?.propertyName ?? '',
        address: prop?.address ?? null,
        listed: r.listed,
        listedDate: r.listedDate ?? null,
        daysListed,
        availableDate: r.availableDate ?? null,
        listingRent: r.listingRent ?? 0,
        listingDeposit: r.listingDeposit ?? 0,
        contactName: r.contactName ?? '',
        contactPhone: r.contactPhone ?? '',
        contactEmail: r.contactEmail ?? '',
        unitAmenities: r.unitAmenities ?? [],
        unitDescription: r.unitDescription ?? '',
        unitImages: (r.unitImages ?? []).map((id) => String(id)),
        leaseTermsBlurb: r.leaseTermsBlurb ?? '',
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

  const parsed = listingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  // Resolve unit → propertyId for the listing row.
  const conn = mongoose.connection;
  if (!conn?.db) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
  }
  const unit = (await conn.db
    .collection('pm_units')
    .findOne({
      _id: new Types.ObjectId(parsed.data.unitId),
      organizationId: orgObjectId,
    })) as unknown as UnitRow | null;
  if (!unit) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
  }

  // BR-LA-1 — even a Listed=false row is fine; we only block the toggle.
  // No occupancy check needed at create.

  try {
    const doc = await Listing.create({
      organizationId: orgObjectId,
      unitId: new Types.ObjectId(parsed.data.unitId),
      propertyId: unit.propertyId as Types.ObjectId,
      listed: false,
      listedDate: null,
      availableDate: parsed.data.availableDate
        ? new Date(parsed.data.availableDate)
        : null,
      listingRent: toCents(parsed.data.listingRent ?? 0),
      listingDeposit: toCents(parsed.data.listingDeposit ?? 0),
      contactName: parsed.data.contactName,
      contactPhone: parsed.data.contactPhone,
      contactEmail: parsed.data.contactEmail,
      unitAmenities: parsed.data.unitAmenities ?? [],
      unitDescription: parsed.data.unitDescription,
      unitImages: (parsed.data.unitImages ?? []).map(
        (id) => new Types.ObjectId(id),
      ),
      leaseTermsBlurb: parsed.data.leaseTermsBlurb,
      customFields: parsed.data.customFields ?? {},
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Listing',
      parentId: doc._id,
      eventType: 'Listing created',
      actorUserId: ctx.userId,
      payload: { unitId: String(doc.unitId) },
    });

    return NextResponse.json({ id: String(doc._id) }, { status: 201 });
  } catch (err: unknown) {
    // Mongo unique-index violation for the (org, unitId) pair.
    const msg = err instanceof Error ? err.message : 'Failed to create listing';
    if (/duplicate key/i.test(msg)) {
      return NextResponse.json(
        { error: 'A listing already exists for this unit.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

