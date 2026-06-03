// Tenant CRUD (skeleton — PDR §3.5). Lease-bound fields (`currentLeaseId`)
// land in Phase 3.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Property } from '@/lib/db/models/pm/Property';
import { Unit } from '@/lib/db/models/pm/Unit';
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
  currentLeaseId?: unknown;
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

  // Batch-resolve each tenant's current lease → property/unit name. Three
  // extra queries total, independent of row count (no per-row lookups).
  const orgId = new Types.ObjectId(ctx.orgId);
  const leaseById = new Map<
    string,
    { propertyId: string; unitId: string }
  >();
  const propNameById = new Map<string, string>();
  const unitNameById = new Map<string, string>();

  const leaseIds = Array.from(
    new Set(
      rows
        .map((r) => r.currentLeaseId)
        .filter((v): v is unknown => Boolean(v))
        .map((v) => String(v)),
    ),
  ).map((s) => new Types.ObjectId(s));

  if (leaseIds.length > 0) {
    const leases = await Lease.find({ organizationId: orgId, _id: { $in: leaseIds } })
      .select({ propertyId: 1, unitId: 1 })
      .lean<
        { _id: Types.ObjectId; propertyId: Types.ObjectId; unitId: Types.ObjectId }[]
      >();
    const propIds = new Set<string>();
    const unitIds = new Set<string>();
    for (const l of leases) {
      leaseById.set(String(l._id), {
        propertyId: String(l.propertyId),
        unitId: String(l.unitId),
      });
      propIds.add(String(l.propertyId));
      unitIds.add(String(l.unitId));
    }
    const [props, units] = await Promise.all([
      Property.find({
        organizationId: orgId,
        _id: { $in: Array.from(propIds).map((s) => new Types.ObjectId(s)) },
      })
        .select({ propertyName: 1 })
        .lean<{ _id: Types.ObjectId; propertyName?: string }[]>(),
      Unit.find({
        organizationId: orgId,
        _id: { $in: Array.from(unitIds).map((s) => new Types.ObjectId(s)) },
      })
        .select({ unitId: 1 })
        .lean<{ _id: Types.ObjectId; unitId?: string }[]>(),
    ]);
    for (const p of props) propNameById.set(String(p._id), p.propertyName ?? '');
    for (const u of units) unitNameById.set(String(u._id), u.unitId ?? '');
  }

  return NextResponse.json(
    rows.map((r) => {
      const leaseId = r.currentLeaseId ? String(r.currentLeaseId) : null;
      const lease = leaseId ? leaseById.get(leaseId) : null;
      return {
        id: String(r._id),
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email ?? '',
        cosignerFlag: r.cosignerFlag,
        active: r.active,
        displayName: `${r.firstName} ${r.lastName}`.trim(),
        currentLeaseId: leaseId,
        currentLease: lease
          ? {
              propertyId: lease.propertyId,
              propertyName:
                propNameById.get(lease.propertyId) || '(Unknown property)',
              unitName: unitNameById.get(lease.unitId) || '(Unknown unit)',
            }
          : null,
      };
    }),
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
