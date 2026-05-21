// RentalOwner CRUD (PDR_MASTER §3.6). `propertiesOwned` is derived per-owner
// on the GET-one route by reverse-querying Property.rentalOwners. List view
// returns lightweight rows.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RentalOwner } from '@/lib/db/models/pm/RentalOwner';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { rentalOwnerCreateSchema } from '@/lib/validation/pm/rentalOwner';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface OwnerLeanLike {
  _id: unknown;
  firstName: string;
  lastName: string;
  isCompany: boolean;
  companyName?: string;
  primaryEmail?: string;
  managementAgreement?: { endDate?: Date | null };
  active: boolean;
}

function displayName(d: OwnerLeanLike): string {
  if (d.isCompany && d.companyName) return d.companyName;
  return `${d.firstName} ${d.lastName}`.trim();
}

function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === '1';
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeInactive) filter.active = true;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { companyName: rx },
      { primaryEmail: rx },
    ];
  }

  const rows = await RentalOwner.find(filter)
    .sort({ lastName: 1, firstName: 1 })
    .lean<OwnerLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      firstName: r.firstName,
      lastName: r.lastName,
      isCompany: r.isCompany,
      companyName: r.companyName ?? '',
      primaryEmail: r.primaryEmail ?? '',
      displayName: displayName(r),
      managementAgreementEndDate: r.managementAgreement?.endDate ?? null,
      daysUntilAgreementEnds: daysUntil(r.managementAgreement?.endDate ?? null),
      active: r.active,
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

  const parsed = rentalOwnerCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await RentalOwner.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    isCompany: parsed.data.isCompany ?? false,
    companyName: parsed.data.companyName,
    dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : null,
    managementAgreement: {
      startDate: parsed.data.managementAgreement?.startDate
        ? new Date(parsed.data.managementAgreement.startDate)
        : null,
      endDate: parsed.data.managementAgreement?.endDate
        ? new Date(parsed.data.managementAgreement.endDate)
        : null,
    },
    primaryEmail: parsed.data.primaryEmail,
    alternateEmail: parsed.data.alternateEmail,
    phones: parsed.data.phones,
    address: parsed.data.address,
    comments: parsed.data.comments,
    taxIdentityType: parsed.data.taxIdentityType ?? null,
    taxpayerIdLast4: parsed.data.taxpayerIdLast4,
    use1099AlternateName: parsed.data.use1099AlternateName ?? false,
    alternativeName1099: parsed.data.alternativeName1099,
    use1099AlternateAddress: parsed.data.use1099AlternateAddress ?? false,
    alternativeAddress1099: parsed.data.alternativeAddress1099,
    customFields: parsed.data.customFields ?? {},
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'RentalOwner',
    parentId: doc._id,
    eventType: 'Rental owner created',
    actorUserId: ctx.userId,
    payload: { name: displayName(doc.toObject() as unknown as OwnerLeanLike) },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
