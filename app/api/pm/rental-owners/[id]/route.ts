// Per-row CRUD on RentalOwner. GET inflates `propertiesOwned` from the
// Property collection (junction lives on Property.rentalOwners[]). Property
// is queried via the raw mongoose connection so the route works even if the
// PmProperty model has not been registered yet in this Node process.
import { NextResponse } from 'next/server';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RentalOwner } from '@/lib/db/models/pm/RentalOwner';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { rentalOwnerUpdateSchema } from '@/lib/validation/pm/rentalOwner';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return RentalOwner.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

interface PropertyJunctionRow {
  _id: unknown;
  propertyName: string;
  rentalOwners?: Array<{ rentalOwnerId: unknown; ownershipPct: number }>;
}

async function loadPropertiesOwned(
  ownerId: Types.ObjectId,
  orgId: Types.ObjectId,
): Promise<Array<{ propertyId: string; propertyName: string; ownershipPct: number }>> {
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1 || !conn.db) return [];
  const rows = (await conn.db
    .collection('pm_properties')
    .find({ organizationId: orgId, 'rentalOwners.rentalOwnerId': ownerId })
    .project({ propertyName: 1, rentalOwners: 1 })
    .toArray()) as unknown as PropertyJunctionRow[];
  return rows.flatMap((p) =>
    (p.rentalOwners ?? [])
      .filter((j) => String(j.rentalOwnerId) === String(ownerId))
      .map((j) => ({
        propertyId: String(p._id),
        propertyName: p.propertyName,
        ownershipPct: j.ownershipPct,
      })),
  );
}

function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const propertiesOwned = await loadPropertiesOwned(
    doc._id,
    new Types.ObjectId(ctx.orgId),
  );

  const customFields: Record<string, unknown> = {};
  if (doc.customFields instanceof Map) {
    doc.customFields.forEach((v, k) => {
      customFields[k] = v;
    });
  } else if (doc.customFields) {
    Object.assign(customFields, doc.customFields);
  }

  return NextResponse.json({
    id: String(doc._id),
    firstName: doc.firstName,
    lastName: doc.lastName,
    isCompany: doc.isCompany,
    companyName: doc.companyName ?? '',
    displayName: doc.isCompany && doc.companyName
      ? doc.companyName
      : `${doc.firstName} ${doc.lastName}`.trim(),
    dateOfBirth: doc.dateOfBirth ?? null,
    managementAgreement: {
      startDate: doc.managementAgreement?.startDate ?? null,
      endDate: doc.managementAgreement?.endDate ?? null,
    },
    daysUntilAgreementEnds: daysUntil(doc.managementAgreement?.endDate ?? null),
    primaryEmail: doc.primaryEmail ?? '',
    alternateEmail: doc.alternateEmail ?? '',
    phones: doc.phones ?? {},
    address: doc.address ?? {},
    comments: doc.comments ?? '',
    taxIdentityType: doc.taxIdentityType ?? null,
    taxpayerIdLast4: doc.taxpayerIdLast4 ?? '',
    use1099AlternateName: doc.use1099AlternateName,
    alternativeName1099: doc.alternativeName1099 ?? '',
    use1099AlternateAddress: doc.use1099AlternateAddress,
    alternativeAddress1099: doc.alternativeAddress1099 ?? null,
    customFields,
    active: doc.active,
    propertiesOwned,
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

  const parsed = rentalOwnerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const {
    dateOfBirth,
    managementAgreement,
    customFields,
    ...rest
  } = parsed.data;
  Object.assign(doc, rest);
  if (dateOfBirth !== undefined) {
    doc.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
  }
  if (managementAgreement !== undefined) {
    doc.managementAgreement = {
      startDate: managementAgreement.startDate
        ? new Date(managementAgreement.startDate)
        : null,
      endDate: managementAgreement.endDate
        ? new Date(managementAgreement.endDate)
        : null,
    };
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'RentalOwner',
    parentId: doc._id,
    eventType: 'Rental owner updated',
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
  doc.active = false;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'RentalOwner',
    parentId: doc._id,
    eventType: 'Rental owner archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
