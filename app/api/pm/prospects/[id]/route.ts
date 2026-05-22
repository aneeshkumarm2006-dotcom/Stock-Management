// Per-row CRUD on Prospect.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Prospect } from '@/lib/db/models/pm/Prospect';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { prospectUpdateSchema } from '@/lib/validation/pm/prospect';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Prospect.findOne({
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

  return NextResponse.json({
    id: String(doc._id),
    firstName: doc.firstName,
    lastName: doc.lastName,
    displayName: `${doc.firstName} ${doc.lastName}`.trim(),
    email: doc.email ?? '',
    phone: doc.phone ?? '',
    status: doc.status,
    propertyId: doc.propertyId ? String(doc.propertyId) : null,
    movingDate: doc.movingDate ?? null,
    beds: doc.beds ?? null,
    notes: doc.notes ?? '',
    convertedToApplicantId: doc.convertedToApplicantId
      ? String(doc.convertedToApplicantId)
      : null,
    convertedAt: doc.convertedAt ?? null,
    customFields: doc.customFields instanceof Map
      ? Object.fromEntries(doc.customFields)
      : doc.customFields ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
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

  const parsed = prospectUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { propertyId, movingDate, customFields, ...rest } = parsed.data;
  Object.assign(doc, rest);
  if (propertyId !== undefined) {
    doc.propertyId = propertyId ? new Types.ObjectId(propertyId) : null;
  }
  if (movingDate !== undefined) {
    doc.movingDate = movingDate ? new Date(movingDate) : null;
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Prospect',
    parentId: doc._id,
    eventType: 'Prospect updated',
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
  // Prospect is lightweight: delete outright. Converted prospects can be
  // archived but the cross-link survives on the Applicant doc.
  await doc.deleteOne();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Prospect',
    parentId: doc._id,
    eventType: 'Prospect deleted',
    actorUserId: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
