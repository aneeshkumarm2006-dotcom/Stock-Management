// VendorCategory CRUD (PDR_MASTER §3.12).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { VendorCategory } from '@/lib/db/models/pm/VendorCategory';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { vendorCategoryCreateSchema } from '@/lib/validation/pm/vendorCategory';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  const cls = d.class as string;
  const sub = (d.subCategory as string) || '';
  return {
    id: String(d._id),
    class: cls,
    subCategory: sub,
    displayName: sub ? `${cls} - ${sub}` : cls,
    systemSeeded: d.systemSeeded,
    active: d.active,
  };
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const rows = await VendorCategory.find({
    organizationId: new Types.ObjectId(ctx.orgId),
    active: true,
  })
    .sort({ class: 1, subCategory: 1 })
    .lean();

  return NextResponse.json(rows.map(serialize));
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

  const parsed = vendorCategoryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  try {
    const doc = await VendorCategory.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      class: parsed.data.class,
      subCategory: parsed.data.subCategory ?? '',
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Vendor',
      parentId: doc._id,
      eventType: 'Vendor category created',
      actorUserId: ctx.userId,
    });

    return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), { status: 201 });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: 'A category with this class+subCategory already exists' },
        { status: 409 },
      );
    }
    throw err;
  }
}
