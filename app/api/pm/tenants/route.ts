// Tenant CRUD (skeleton — PDR §3.5). Lease-bound fields (`currentLeaseId`)
// land in Phase 3.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Property } from '@/lib/db/models/pm/Property';
import { Unit } from '@/lib/db/models/pm/Unit';
import { CompanyAccount } from '@/lib/db/models/pm/CompanyAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { tenantCreateSchema } from '@/lib/validation/pm/tenant';
import { logActivity } from '@/lib/pm/activity';
import { tenantDisplayName } from '@/lib/pm/tenantName';
import { normalizeCountry, OTHER } from '@/lib/pm/country';
import type { TenantType } from '@/types/pm';

export const runtime = 'nodejs';

interface TenantLeanLike {
  _id: unknown;
  tenantType?: TenantType;
  firstName: string;
  lastName: string;
  companyName?: string;
  contactPersonName?: string;
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
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { companyName: rx },
      { contactPersonName: rx },
      { email: rx },
    ];
  }
  const rows = await Tenant.find(filter)
    .sort({ lastName: 1, firstName: 1 })
    .lean<TenantLeanLike[]>();

  // Batch-resolve each tenant's current lease → property (name, country,
  // parent company) + unit name. Four extra queries total, independent of row
  // count (no per-row lookups).
  const orgId = new Types.ObjectId(ctx.orgId);
  const leaseById = new Map<
    string,
    { propertyId: string; unitId: string }
  >();
  // The list groups by property, country and parent company, so the property
  // lookup below carries all three rather than the name alone.
  const propById = new Map<
    string,
    { name: string; country: string; companyAccountId: string | null }
  >();
  const unitNameById = new Map<string, string>();
  const companyNameById = new Map<string, string>();

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
        .select({ propertyName: 1, 'address.country': 1, companyAccountId: 1 })
        .lean<
          {
            _id: Types.ObjectId;
            propertyName?: string;
            address?: { country?: string };
            companyAccountId?: Types.ObjectId | null;
          }[]
        >(),
      Unit.find({
        organizationId: orgId,
        _id: { $in: Array.from(unitIds).map((s) => new Types.ObjectId(s)) },
      })
        .select({ unitId: 1 })
        .lean<{ _id: Types.ObjectId; unitId?: string }[]>(),
    ]);
    for (const p of props) {
      propById.set(String(p._id), {
        name: p.propertyName ?? '',
        // Bucketed server-side (as the leases route does) so every surface
        // groups identically and the client never re-derives it.
        country: normalizeCountry(p.address?.country),
        companyAccountId: p.companyAccountId ? String(p.companyAccountId) : null,
      });
    }
    for (const u of units) unitNameById.set(String(u._id), u.unitId ?? '');

    // One $in for the parent companies, mirroring the properties list.
    const companyIds = Array.from(
      new Set(
        Array.from(propById.values())
          .map((p) => p.companyAccountId)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    if (companyIds.length > 0) {
      const companies = await CompanyAccount.find({
        organizationId: orgId,
        _id: { $in: companyIds.map((s) => new Types.ObjectId(s)) },
      })
        .select({ name: 1 })
        .lean<{ _id: Types.ObjectId; name?: string }[]>();
      for (const c of companies) {
        companyNameById.set(String(c._id), c.name ?? '');
      }
    }
  }

  // Property/unit for a tenant's CURRENT active lease. Country and company
  // ride along so the list can section rows the way Properties does.
  function serializeCurrentLease(lease: { propertyId: string; unitId: string }) {
    const prop = propById.get(lease.propertyId);
    const companyAccountId = prop?.companyAccountId ?? null;
    return {
      propertyId: lease.propertyId,
      propertyName: prop?.name || '(Unknown property)',
      unitName: unitNameById.get(lease.unitId) || '(Unknown unit)',
      country: prop?.country ?? OTHER,
      companyAccountId,
      companyName: companyAccountId
        ? (companyNameById.get(companyAccountId) || '(unknown company)')
        : null,
    };
  }

  return NextResponse.json(
    rows.map((r) => {
      const leaseId = r.currentLeaseId ? String(r.currentLeaseId) : null;
      const lease = leaseId ? leaseById.get(leaseId) : null;
      return {
        id: String(r._id),
        tenantType: r.tenantType ?? 'Individual',
        firstName: r.firstName,
        lastName: r.lastName,
        companyName: r.companyName ?? '',
        contactPersonName: r.contactPersonName ?? '',
        email: r.email ?? '',
        cosignerFlag: r.cosignerFlag,
        active: r.active,
        displayName: tenantDisplayName(r),
        currentLeaseId: leaseId,
        currentLease: lease ? serializeCurrentLease(lease) : null,
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
  const tenantType = parsed.data.tenantType ?? 'Individual';
  const doc = await Tenant.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    tenantType,
    firstName: parsed.data.firstName ?? '',
    lastName: parsed.data.lastName ?? '',
    companyName: parsed.data.companyName,
    contactPersonName: parsed.data.contactPersonName,
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
    payload: { name: tenantDisplayName(doc) },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
