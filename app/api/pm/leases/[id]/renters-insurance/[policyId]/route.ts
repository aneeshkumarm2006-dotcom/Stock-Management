// GET / PATCH / DELETE /api/pm/leases/:id/renters-insurance/:policyId
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RentersInsurancePolicy } from '@/lib/db/models/pm/RentersInsurancePolicy';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { rentersInsuranceUpdateSchema } from '@/lib/validation/pm/rentersInsurance';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';

export const runtime = 'nodejs';

async function load(policyId: string, leaseId: string, orgId: string) {
  if (
    !Types.ObjectId.isValid(policyId) ||
    !Types.ObjectId.isValid(leaseId)
  ) {
    return null;
  }
  await connectToDatabase();
  return RentersInsurancePolicy.findOne({
    _id: new Types.ObjectId(policyId),
    leaseId: new Types.ObjectId(leaseId),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string; policyId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.policyId, params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    id: String(doc._id),
    leaseId: String(doc.leaseId),
    carrier: doc.carrier,
    policyNumber: doc.policyNumber ?? '',
    liabilityCoverage: doc.liabilityCoverage,
    effectiveDate: doc.effectiveDate,
    expirationDate: doc.expirationDate,
    coveredResidents: (doc.coveredResidents ?? []).map((id) => String(id)),
    documentFileId: doc.documentFileId ? String(doc.documentFileId) : null,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; policyId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = rentersInsuranceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.policyId, params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const {
    liabilityCoverage,
    effectiveDate,
    expirationDate,
    coveredResidents,
    documentFileId,
    ...rest
  } = parsed.data;
  Object.assign(doc, rest);
  if (liabilityCoverage !== undefined) {
    doc.liabilityCoverage = toCents(liabilityCoverage);
  }
  if (effectiveDate !== undefined) doc.effectiveDate = new Date(effectiveDate);
  if (expirationDate !== undefined) {
    doc.expirationDate = new Date(expirationDate);
  }
  if (coveredResidents !== undefined) {
    doc.coveredResidents = coveredResidents.map(
      (id) => new Types.ObjectId(id),
    );
  }
  if (documentFileId !== undefined) {
    doc.documentFileId = documentFileId
      ? new Types.ObjectId(documentFileId)
      : null;
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Lease',
    parentId: new Types.ObjectId(params.id),
    eventType: 'Renters insurance policy updated',
    actorUserId: ctx.userId,
    payload: { policyId: String(doc._id), carrier: doc.carrier },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; policyId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.policyId, params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Lease',
    parentId: new Types.ObjectId(params.id),
    eventType: 'Renters insurance policy removed',
    actorUserId: ctx.userId,
    payload: { policyId: params.policyId },
  });

  return NextResponse.json({ ok: true });
}
