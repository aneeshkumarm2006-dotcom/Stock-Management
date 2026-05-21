// Per-row CRUD on VendorCategory. Soft-archive (active=false) — full delete
// blocked when systemSeeded.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { VendorCategory } from '@/lib/db/models/pm/VendorCategory';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { vendorCategoryUpdateSchema } from '@/lib/validation/pm/vendorCategory';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return VendorCategory.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
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

  const parsed = vendorCategoryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.systemSeeded && (parsed.data.class || parsed.data.subCategory)) {
    return NextResponse.json(
      { error: 'System-seeded categories cannot be renamed' },
      { status: 400 },
    );
  }

  Object.assign(doc, parsed.data);
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Vendor',
    parentId: doc._id,
    eventType: 'Vendor category updated',
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
  if (doc.systemSeeded) {
    return NextResponse.json(
      { error: 'System-seeded categories cannot be deleted' },
      { status: 400 },
    );
  }

  doc.active = false;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Vendor',
    parentId: doc._id,
    eventType: 'Vendor category archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
