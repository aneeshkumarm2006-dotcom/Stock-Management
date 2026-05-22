// GET / POST /api/pm/leases/:id/renters-insurance
//
// Nested under the lease so leaseId is implicit. Honours the model
// pre('validate') that enforces `expirationDate > effectiveDate`.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Property } from '@/lib/db/models/pm/Property';
import { RentersInsurancePolicy } from '@/lib/db/models/pm/RentersInsurancePolicy';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { rentersInsuranceCreateSchema } from '@/lib/validation/pm/rentersInsurance';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  await connectToDatabase();
  const rows = await RentersInsurancePolicy.find({
    organizationId: new Types.ObjectId(ctx.orgId),
    leaseId: new Types.ObjectId(params.id),
  })
    .sort({ expirationDate: -1 })
    .lean();
  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      leaseId: String(r.leaseId),
      carrier: r.carrier,
      policyNumber: r.policyNumber ?? '',
      liabilityCoverage: r.liabilityCoverage,
      effectiveDate: r.effectiveDate,
      expirationDate: r.expirationDate,
      coveredResidents: (r.coveredResidents ?? []).map((id) => String(id)),
      documentFileId: r.documentFileId ? String(r.documentFileId) : null,
    })),
  );
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  // Inject the leaseId from the URL so the validator can accept it.
  const parsed = rentersInsuranceCreateSchema.safeParse({
    ...(typeof body === 'object' && body ? body : {}),
    leaseId: params.id,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const lease = await Lease.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgId,
  })
    .select({ propertyId: 1 })
    .lean<{ propertyId: Types.ObjectId } | null>();
  if (!lease) return NextResponse.json({ error: 'Lease not found' }, { status: 404 });

  // Surface a soft warning if liability falls below the property-level
  // minimum (BR-LL-6 — Phase 3 keeps the door open).
  const property = await Property.findOne({
    _id: lease.propertyId,
    organizationId: orgId,
  })
    .select({
      rentersInsuranceMinLiability3rdParty: 1,
      rentersInsuranceMinLiabilityMSI: 1,
    })
    .lean<{
      rentersInsuranceMinLiability3rdParty?: number | null;
      rentersInsuranceMinLiabilityMSI?: number | null;
    } | null>();
  const min =
    parsed.data.carrier === 'MSI'
      ? property?.rentersInsuranceMinLiabilityMSI
      : property?.rentersInsuranceMinLiability3rdParty;
  const liabilityCents = toCents(parsed.data.liabilityCoverage);
  const belowMin =
    typeof min === 'number' && min > 0 && liabilityCents < min;

  try {
    const doc = await RentersInsurancePolicy.create({
      organizationId: orgId,
      leaseId: new Types.ObjectId(params.id),
      carrier: parsed.data.carrier,
      policyNumber: parsed.data.policyNumber,
      liabilityCoverage: liabilityCents,
      effectiveDate: new Date(parsed.data.effectiveDate),
      expirationDate: new Date(parsed.data.expirationDate),
      coveredResidents: (parsed.data.coveredResidents ?? []).map(
        (id) => new Types.ObjectId(id),
      ),
      documentFileId: parsed.data.documentFileId
        ? new Types.ObjectId(parsed.data.documentFileId)
        : null,
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Lease',
      parentId: new Types.ObjectId(params.id),
      eventType: 'Renters insurance policy added',
      actorUserId: ctx.userId,
      payload: {
        policyId: String(doc._id),
        carrier: doc.carrier,
        liabilityCoverage: doc.liabilityCoverage,
        belowMin,
      },
    });

    return NextResponse.json(
      {
        id: String(doc._id),
        warning: belowMin
          ? `liabilityCoverage falls below property minimum (${min}).`
          : null,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save policy';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
