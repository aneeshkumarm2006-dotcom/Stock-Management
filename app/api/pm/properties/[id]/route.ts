// Per-row CRUD on Property (PDR_MASTER §3.1). GET inflates rental-owner
// names and the dependent bank-account names, plus serves derived
// `availableCash = cashBalance − securityDepositsHeld − propertyReserve`
// (BR-PU-3). Phase 1 returns 0 for cashBalance/securityDepositsHeld until
// Phase 2/3 wire the JE + lease roll-ups. DELETE soft-archives (BR-PU-2).
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
import { propertyUpdateSchema } from '@/lib/validation/pm/property';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Property.findOne({
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

  // Pull owner display names in one query.
  const ownerIds = doc.rentalOwners.map((j) => j.rentalOwnerId);
  const owners =
    ownerIds.length === 0
      ? []
      : await RentalOwner.find({
          _id: { $in: ownerIds },
          organizationId: doc.organizationId,
        })
          .select({ firstName: 1, lastName: 1, isCompany: 1, companyName: 1 })
          .lean();
  const ownerMap = new Map<string, string>();
  for (const o of owners) {
    const name =
      o.isCompany && o.companyName
        ? o.companyName
        : `${o.firstName} ${o.lastName}`.trim();
    ownerMap.set(String(o._id), name);
  }

  const bankIds = [doc.operatingAccountId, doc.depositTrustAccountId].filter(
    Boolean,
  ) as Types.ObjectId[];
  const banks =
    bankIds.length === 0
      ? []
      : await BankAccount.find({
          _id: { $in: bankIds },
          organizationId: doc.organizationId,
        })
          .select({ name: 1, accountNumberMasked: 1 })
          .lean();
  const bankMap = new Map<string, { name: string; accountNumberMasked: string }>();
  for (const b of banks) {
    bankMap.set(String(b._id), {
      name: b.name,
      accountNumberMasked: b.accountNumberMasked,
    });
  }

  // Phase 2 wiring: cashBalance + securityDepositsHeld come from JE roll-ups.
  const cashBalance = 0;
  const securityDepositsHeld = 0;
  const availableCash = cashBalance - securityDepositsHeld - (doc.propertyReserve ?? 0);

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
    propertyName: doc.propertyName,
    propertyClass: doc.propertyClass,
    propertySubType: doc.propertySubType,
    address: doc.address,
    photo: doc.photo ? String(doc.photo) : null,
    propertyManagerUserId: doc.propertyManagerUserId
      ? String(doc.propertyManagerUserId)
      : null,
    rentalOwners: doc.rentalOwners.map((j) => ({
      rentalOwnerId: String(j.rentalOwnerId),
      ownershipPct: j.ownershipPct,
      displayName: ownerMap.get(String(j.rentalOwnerId)) ?? '(unknown)',
    })),
    operatingAccount: doc.operatingAccountId
      ? {
          id: String(doc.operatingAccountId),
          ...(bankMap.get(String(doc.operatingAccountId)) ?? {
            name: '(unknown)',
            accountNumberMasked: '',
          }),
        }
      : null,
    depositTrustAccount: doc.depositTrustAccountId
      ? {
          id: String(doc.depositTrustAccountId),
          ...(bankMap.get(String(doc.depositTrustAccountId)) ?? {
            name: '(unknown)',
            accountNumberMasked: '',
          }),
        }
      : null,
    propertyReserve: doc.propertyReserve,
    listingDescription: doc.listingDescription ?? '',
    amenities: doc.amenities ?? [],
    includedInRent: doc.includedInRent ?? [],
    residentCenterPaymentHistory: doc.residentCenterPaymentHistory ?? 'Hidden',
    residentCenterRequests: doc.residentCenterRequests,
    residentCenterForums: doc.residentCenterForums,
    rentersInsuranceMinLiability3rdParty:
      doc.rentersInsuranceMinLiability3rdParty,
    rentersInsuranceMinLiabilityMSI: doc.rentersInsuranceMinLiabilityMSI,
    customFields,
    active: doc.active,
    // Derived
    cashBalance,
    securityDepositsHeld,
    availableCash,
  });
}

async function ensureBankAccountInOrg(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return false;
  const cnt = await BankAccount.countDocuments({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt > 0;
}

async function ensureOwnersInOrg(ids: string[], orgId: string) {
  if (ids.length === 0) return true;
  const objectIds = ids.map((i) => new Types.ObjectId(i));
  const cnt = await RentalOwner.countDocuments({
    _id: { $in: objectIds },
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt === ids.length;
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

  const parsed = propertyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
  if (parsed.data.rentalOwners) {
    const ownerIds = parsed.data.rentalOwners.map((j) => j.rentalOwnerId);
    if (!(await ensureOwnersInOrg(ownerIds, ctx.orgId))) {
      return NextResponse.json(
        { error: 'One or more rentalOwnerId references are invalid for this org' },
        { status: 400 },
      );
    }
  }

  // Apply patch. Hand-translate ObjectId fields + Map.
  const {
    rentalOwners,
    operatingAccountId,
    depositTrustAccountId,
    propertyManagerUserId,
    photo,
    customFields,
    ...rest
  } = parsed.data;
  Object.assign(doc, rest);
  if (rentalOwners !== undefined) {
    doc.rentalOwners = rentalOwners.map((j) => ({
      rentalOwnerId: new Types.ObjectId(j.rentalOwnerId),
      ownershipPct: j.ownershipPct,
    }));
  }
  if (operatingAccountId !== undefined) {
    doc.operatingAccountId = operatingAccountId
      ? new Types.ObjectId(operatingAccountId)
      : null;
  }
  if (depositTrustAccountId !== undefined) {
    doc.depositTrustAccountId = depositTrustAccountId
      ? new Types.ObjectId(depositTrustAccountId)
      : null;
  }
  if (propertyManagerUserId !== undefined) {
    doc.propertyManagerUserId = propertyManagerUserId
      ? new Types.ObjectId(propertyManagerUserId)
      : null;
  }
  if (photo !== undefined) {
    doc.photo = photo ? new Types.ObjectId(photo) : null;
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  try {
    await doc.save();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Property',
    parentId: doc._id,
    eventType: 'Property updated',
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
    parentType: 'Property',
    parentId: doc._id,
    eventType: 'Property inactivated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
