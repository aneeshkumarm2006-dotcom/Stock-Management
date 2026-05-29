// GET / PATCH / DELETE /api/pm/leases/:id/pets/:petId
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Pet } from '@/lib/db/models/pm/Pet';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { petUpdateSchema } from '@/lib/validation/pm/pet';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(petId: string, leaseId: string, orgId: string) {
  if (!Types.ObjectId.isValid(petId) || !Types.ObjectId.isValid(leaseId)) {
    return null;
  }
  await connectToDatabase();
  return Pet.findOne({
    _id: new Types.ObjectId(petId),
    leaseId: new Types.ObjectId(leaseId),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string; petId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.petId, params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    id: String(doc._id),
    leaseId: String(doc.leaseId),
    name: doc.name,
    petType: doc.petType,
    breed: doc.breed ?? '',
    weightLbs: doc.weightLbs ?? null,
    ageYears: doc.ageYears ?? null,
    licenseNumber: doc.licenseNumber ?? '',
    assistanceAnimal: doc.assistanceAnimal,
    ownerTenantId: doc.ownerTenantId ? String(doc.ownerTenantId) : null,
    notes: doc.notes ?? '',
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; petId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = petUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.petId, params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { ownerTenantId, ...rest } = parsed.data;
  Object.assign(doc, rest);
  if (ownerTenantId !== undefined) {
    doc.ownerTenantId = ownerTenantId
      ? new Types.ObjectId(ownerTenantId)
      : null;
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Lease',
    parentId: new Types.ObjectId(params.id),
    eventType: 'Pet updated',
    actorUserId: ctx.userId,
    payload: { petId: String(doc._id), name: doc.name },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; petId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.petId, params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Lease',
    parentId: new Types.ObjectId(params.id),
    eventType: 'Pet removed',
    actorUserId: ctx.userId,
    payload: { petId: params.petId, name: doc.name },
  });

  return NextResponse.json({ ok: true });
}
