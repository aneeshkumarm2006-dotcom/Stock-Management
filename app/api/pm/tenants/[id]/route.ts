// Per-row CRUD on Tenant (skeleton).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { tenantUpdateSchema } from '@/lib/validation/pm/tenant';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Tenant.findOne({
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
    displayName: `${doc.firstName} ${doc.lastName}`.trim(),
    email: doc.email ?? '',
    phones: doc.phones ?? {},
    address: doc.address ?? {},
    dateOfBirth: doc.dateOfBirth ?? null,
    ssnLast4: doc.ssnLast4 ?? '',
    cosignerFlag: doc.cosignerFlag,
    residentCenterAccess: doc.residentCenterAccess,
    customFields,
    active: doc.active,
    // Phase 3 wiring once Lease lands.
    currentLeaseId: null,
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

  const parsed = tenantUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { dateOfBirth, customFields, ...rest } = parsed.data;
  Object.assign(doc, rest);
  if (dateOfBirth !== undefined) {
    doc.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Tenant',
    parentId: doc._id,
    eventType: 'Tenant updated',
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
    parentType: 'Tenant',
    parentId: doc._id,
    eventType: 'Tenant archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
