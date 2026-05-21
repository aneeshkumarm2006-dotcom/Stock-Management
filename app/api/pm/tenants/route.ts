// Tenant CRUD (skeleton — PDR §3.5). Lease-bound fields (`currentLeaseId`)
// land in Phase 3.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { tenantCreateSchema } from '@/lib/validation/pm/tenant';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface TenantLeanLike {
  _id: unknown;
  firstName: string;
  lastName: string;
  email?: string;
  cosignerFlag: boolean;
  active: boolean;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === '1';
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeInactive) filter.active = true;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
  }
  const rows = await Tenant.find(filter)
    .sort({ lastName: 1, firstName: 1 })
    .lean<TenantLeanLike[]>();
  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email ?? '',
      cosignerFlag: r.cosignerFlag,
      active: r.active,
      displayName: `${r.firstName} ${r.lastName}`.trim(),
      // Phase 3 wiring once Lease lands.
      currentLeaseId: null,
    })),
  );
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

  const parsed = tenantCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await Tenant.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email,
    phones: parsed.data.phones,
    address: parsed.data.address,
    dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : null,
    ssnLast4: parsed.data.ssnLast4,
    cosignerFlag: parsed.data.cosignerFlag ?? false,
    residentCenterAccess: parsed.data.residentCenterAccess ?? false,
    customFields: parsed.data.customFields ?? {},
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Tenant',
    parentId: doc._id,
    eventType: 'Tenant created',
    actorUserId: ctx.userId,
    payload: { name: `${doc.firstName} ${doc.lastName}` },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
