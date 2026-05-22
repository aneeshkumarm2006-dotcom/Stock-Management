// Per-row CRUD on Listing. DELETE soft-archives (flips listed=false) so
// historical references survive (BR-LA-1 / BR-MV-2 style).
import { NextResponse } from 'next/server';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Listing } from '@/lib/db/models/pm/Listing';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { listingUpdateSchema } from '@/lib/validation/pm/listing';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Listing.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

interface PropertyRollup {
  _id: unknown;
  propertyName: string;
  address?: Record<string, unknown>;
  amenities?: string[];
  includedInRent?: string[];
  listingDescription?: string;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const conn = mongoose.connection;
  let propertyRollup: PropertyRollup | null = null;
  if (conn?.db) {
    propertyRollup = (await conn.db
      .collection('pm_properties')
      .findOne(
        { _id: doc.propertyId, organizationId: doc.organizationId },
        {
          projection: {
            propertyName: 1,
            address: 1,
            amenities: 1,
            includedInRent: 1,
            listingDescription: 1,
          },
        },
      )) as unknown as PropertyRollup | null;
  }

  const listedDate = doc.listedDate ? new Date(doc.listedDate) : null;
  const daysListed =
    listedDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - listedDate.getTime()) / (24 * 60 * 60 * 1000),
          ),
        )
      : null;

  return NextResponse.json({
    id: String(doc._id),
    unitId: String(doc.unitId),
    propertyId: String(doc.propertyId),
    listed: doc.listed,
    listedDate: doc.listedDate ?? null,
    daysListed,
    availableDate: doc.availableDate ?? null,
    listingRent: doc.listingRent,
    listingDeposit: doc.listingDeposit,
    contactName: doc.contactName ?? '',
    contactPhone: doc.contactPhone ?? '',
    contactEmail: doc.contactEmail ?? '',
    unitAmenities: doc.unitAmenities ?? [],
    unitDescription: doc.unitDescription ?? '',
    unitImages: (doc.unitImages ?? []).map((id) => String(id)),
    leaseTermsBlurb: doc.leaseTermsBlurb ?? '',
    property: propertyRollup
      ? {
          propertyName: propertyRollup.propertyName ?? '',
          address: propertyRollup.address ?? {},
          amenities: propertyRollup.amenities ?? [],
          includedInRent: propertyRollup.includedInRent ?? [],
          listingDescription: propertyRollup.listingDescription ?? '',
        }
      : null,
    customFields: doc.customFields instanceof Map
      ? Object.fromEntries(doc.customFields)
      : doc.customFields ?? {},
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

  const parsed = listingUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const {
    availableDate,
    listingRent,
    listingDeposit,
    unitImages,
    customFields,
    listed,
    ...rest
  } = parsed.data;

  Object.assign(doc, rest);
  if (availableDate !== undefined) {
    doc.availableDate = availableDate ? new Date(availableDate) : null;
  }
  if (listingRent !== undefined) doc.listingRent = toCents(listingRent);
  if (listingDeposit !== undefined) {
    doc.listingDeposit = toCents(listingDeposit);
  }
  if (unitImages !== undefined) {
    doc.unitImages = unitImages.map((id) => new Types.ObjectId(id));
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  if (listed !== undefined) doc.listed = listed; // direct toggle still ok via PATCH

  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Listing',
    parentId: doc._id,
    eventType: 'Listing updated',
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
  doc.listed = false;
  await doc.save();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Listing',
    parentId: doc._id,
    eventType: 'Listing archived',
    actorUserId: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
