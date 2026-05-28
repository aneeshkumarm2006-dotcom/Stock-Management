// Property CRUD (PDR_MASTER §3.1). Owners FK + bank-account FKs are checked
// in-org on save (BR-PU-1, BR-PU-4). Soft-archive on DELETE (BR-PU-2);
// reactivate via /api/pm/properties/[id]/reactivate.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Property } from '@/lib/db/models/pm/Property';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { RentalOwner } from '@/lib/db/models/pm/RentalOwner';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { propertyCreateSchema } from '@/lib/validation/pm/property';
import { logActivity } from '@/lib/pm/activity';
import { computeWarnings, type PmWarning } from '@/lib/pm/warnings';

export const runtime = 'nodejs';

interface PropertyLeanLike {
  _id: unknown;
  propertyName: string;
  propertyClass: string;
  propertySubType: string;
  address?: { line1?: string; city?: string; state?: string; zip?: string };
  propertyManagerUserId?: unknown;
  rentalOwners?: Array<{ rentalOwnerId: unknown; ownershipPct: number }>;
  active: boolean;
  propertyReserve?: number;
  operatingAccountId?: unknown;
  warnings?: PmWarning[];
}

function listSerialize(p: PropertyLeanLike) {
  return {
    id: String(p._id),
    propertyName: p.propertyName,
    propertyClass: p.propertyClass,
    propertySubType: p.propertySubType,
    address: p.address ?? null,
    propertyManagerUserId: p.propertyManagerUserId
      ? String(p.propertyManagerUserId)
      : null,
    ownerCount: p.rentalOwners?.length ?? 0,
    active: p.active,
    propertyReserve: p.propertyReserve ?? 0,
    operatingAccountId: p.operatingAccountId ? String(p.operatingAccountId) : null,
    warnings: p.warnings ?? [],
  };
}

async function ensureBankAccountInOrg(
  id: string,
  orgId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const cnt = await BankAccount.countDocuments({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt > 0;
}

async function ensureOwnersInOrg(
  ids: string[],
  orgId: string,
): Promise<boolean> {
  if (ids.length === 0) return true;
  const objectIds = ids.map((i) => new Types.ObjectId(i));
  const cnt = await RentalOwner.countDocuments({
    _id: { $in: objectIds },
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt === ids.length;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === '1';
  const propertyClass = searchParams.get('propertyClass');
  const pmUserId = searchParams.get('propertyManagerUserId');
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeInactive) filter.active = true;
  if (propertyClass === 'Residential' || propertyClass === 'Commercial') {
    filter.propertyClass = propertyClass;
  }
  if (pmUserId && Types.ObjectId.isValid(pmUserId)) {
    filter.propertyManagerUserId = new Types.ObjectId(pmUserId);
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ propertyName: rx }, { 'address.line1': rx }, { 'address.city': rx }];
  }

  const rows = await Property.find(filter)
    .sort({ propertyName: 1 })
    .lean<PropertyLeanLike[]>();

  return NextResponse.json(rows.map(listSerialize));
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

  const parsed = propertyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();

  // FK existence checks scoped to this org (BR-PU-4 + owner-junction integrity).
  if (
    parsed.data.operatingAccountId &&
    !(await ensureBankAccountInOrg(parsed.data.operatingAccountId, ctx.orgId))
  ) {
    return NextResponse.json(
      { error: 'operatingAccountId does not reference a bank account in this org' },
      { status: 400 },
    );
  }
  if (
    parsed.data.depositTrustAccountId &&
    !(await ensureBankAccountInOrg(parsed.data.depositTrustAccountId, ctx.orgId))
  ) {
    return NextResponse.json(
      {
        error:
          'depositTrustAccountId does not reference a bank account in this org',
      },
      { status: 400 },
    );
  }
  const ownerIds = (parsed.data.rentalOwners ?? []).map((j) => j.rentalOwnerId);
  if (!(await ensureOwnersInOrg(ownerIds, ctx.orgId))) {
    return NextResponse.json(
      { error: 'One or more rentalOwnerId references are invalid for this org' },
      { status: 400 },
    );
  }

  const doc = await Property.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    propertyName: parsed.data.propertyName ?? '',
    propertyClass: parsed.data.propertyClass ?? 'Residential',
    propertySubType: parsed.data.propertySubType ?? '',
    address: parsed.data.address ?? {},
    photo: parsed.data.photo ? new Types.ObjectId(parsed.data.photo) : null,
    propertyManagerUserId: parsed.data.propertyManagerUserId
      ? new Types.ObjectId(parsed.data.propertyManagerUserId)
      : null,
    rentalOwners: (parsed.data.rentalOwners ?? []).map((j) => ({
      rentalOwnerId: new Types.ObjectId(j.rentalOwnerId),
      ownershipPct: j.ownershipPct,
    })),
    operatingAccountId: parsed.data.operatingAccountId
      ? new Types.ObjectId(parsed.data.operatingAccountId)
      : null,
    depositTrustAccountId: parsed.data.depositTrustAccountId
      ? new Types.ObjectId(parsed.data.depositTrustAccountId)
      : null,
    propertyReserve: parsed.data.propertyReserve ?? 0,
    listingDescription: parsed.data.listingDescription,
    amenities: parsed.data.amenities ?? [],
    includedInRent: parsed.data.includedInRent ?? [],
    residentCenterPaymentHistory:
      parsed.data.residentCenterPaymentHistory ?? 'Hidden',
    residentCenterRequests: parsed.data.residentCenterRequests ?? {
      enabled: false,
      showEntryQuestions: false,
    },
    residentCenterForums: parsed.data.residentCenterForums ?? false,
    rentersInsuranceMinLiability3rdParty:
      parsed.data.rentersInsuranceMinLiability3rdParty ?? null,
    rentersInsuranceMinLiabilityMSI:
      parsed.data.rentersInsuranceMinLiabilityMSI ?? null,
    customFields: parsed.data.customFields ?? {},
  });

  // Stamp warnings based on the just-created doc's state. Saved back so the
  // list view can read them without recomputing.
  const computed = computeWarnings(doc.toObject(), 'Property');
  if (computed.length > 0) {
    doc.warnings = computed;
    await doc.save();
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Property',
    parentId: doc._id,
    eventType: 'Property created',
    actorUserId: ctx.userId,
    payload: { propertyName: doc.propertyName },
  });

  return NextResponse.json(
    { id: String(doc._id), warnings: doc.warnings },
    { status: 201 },
  );
}
