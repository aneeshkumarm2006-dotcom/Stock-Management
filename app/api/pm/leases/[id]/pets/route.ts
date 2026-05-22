// GET / POST /api/pm/leases/:id/pets
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Pet } from '@/lib/db/models/pm/Pet';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { petCreateSchema } from '@/lib/validation/pm/pet';
import { logActivity } from '@/lib/pm/activity';

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
  const rows = await Pet.find({
    organizationId: new Types.ObjectId(ctx.orgId),
    leaseId: new Types.ObjectId(params.id),
  }).lean();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      leaseId: String(r.leaseId),
      name: r.name,
      petType: r.petType,
      breed: r.breed ?? '',
      weightLbs: r.weightLbs ?? null,
      ageYears: r.ageYears ?? null,
      licenseNumber: r.licenseNumber ?? '',
      assistanceAnimal: r.assistanceAnimal,
      ownerTenantId: r.ownerTenantId ? String(r.ownerTenantId) : null,
      notes: r.notes ?? '',
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
  const parsed = petCreateSchema.safeParse({
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
  const doc = await Pet.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    leaseId: new Types.ObjectId(params.id),
    ownerTenantId: parsed.data.ownerTenantId
      ? new Types.ObjectId(parsed.data.ownerTenantId)
      : null,
    name: parsed.data.name,
    petType: parsed.data.petType,
    breed: parsed.data.breed,
    weightLbs: parsed.data.weightLbs,
    ageYears: parsed.data.ageYears,
    licenseNumber: parsed.data.licenseNumber,
    assistanceAnimal: parsed.data.assistanceAnimal ?? false,
    notes: parsed.data.notes,
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Lease',
    parentId: new Types.ObjectId(params.id),
    eventType: 'Pet added to lease',
    actorUserId: ctx.userId,
    payload: { petId: String(doc._id), name: doc.name, petType: doc.petType },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
