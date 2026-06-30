// Per-row CRUD on Tenant (skeleton).
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
import { tenantUpdateSchema } from '@/lib/validation/pm/tenant';
import { logActivity } from '@/lib/pm/activity';
import { tenantDisplayName } from '@/lib/pm/tenantName';
import { syncTenantSnapshots } from '@/lib/pm/tenantSync';
import { computeLeaseStatus } from '@/lib/pm/leaseStatus';
import { computePeriodAmounts } from '@/lib/pm/rentSchedule';

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

  // Resolve the active lease (set by leasingPromotion / recomputeLeaseStatuses)
  // into a property/unit summary for the Lease card on the detail page.
  let currentLease: {
    id: string;
    leaseNumber: number;
    propertyId: string;
    propertyName: string;
    unitId: string;
    unitName: string;
    status: string;
    leaseType: string;
    startDate: Date | null;
    endDate: Date | null;
    primaryRentAmount: number; // cents — Base Rent only
    totalRentAmount: number; // cents — Base Rent + OPEX/Tax recovery splits (§4)
    splitRentCharges: { amount: number; memo: string }[]; // cents, label in memo
  } | null = null;
  if (doc.currentLeaseId) {
    const lease = await Lease.findOne({
      _id: doc.currentLeaseId,
      organizationId: doc.organizationId,
    }).lean();
    if (lease) {
      const [prop, unit] = await Promise.all([
        Property.findOne({
          _id: lease.propertyId,
          organizationId: doc.organizationId,
        })
          .select({ propertyName: 1 })
          .lean<{ propertyName?: string } | null>(),
        Unit.findOne({
          _id: lease.unitId,
          organizationId: doc.organizationId,
        })
          .select({ unitId: 1 })
          .lean<{ unitId?: string } | null>(),
      ]);
      currentLease = {
        id: String(lease._id),
        leaseNumber: lease.leaseNumber,
        propertyId: String(lease.propertyId),
        propertyName: prop?.propertyName ?? '(Unknown property)',
        unitId: String(lease.unitId),
        unitName: unit?.unitId ?? '(Unknown unit)',
        status: lease.status,
        leaseType: lease.leaseType,
        startDate: lease.startDate ?? null,
        endDate: lease.endDate ?? null,
        primaryRentAmount: lease.primaryRent?.amount ?? 0,
        // §4 — full monthly rent = Base Rent + OPEX/Tax recovery splits.
        totalRentAmount:
          (lease.primaryRent?.amount ?? 0) +
          (lease.splitRentCharges ?? []).reduce(
            (s, c) => s + (c.amount ?? 0),
            0,
          ),
        splitRentCharges: (lease.splitRentCharges ?? []).map((c) => ({
          amount: c.amount ?? 0,
          memo: c.memo ?? '',
        })),
      };
    }
  }

  // All leases this tenant appears on (as tenant OR cosigner), past + present +
  // future, each with its rent schedule — powers the "Lease terms (past &
  // future)" history on the tenant detail page. Sorted oldest-first.
  const tenantLeases = await Lease.find({
    organizationId: doc.organizationId,
    $or: [
      { 'tenants.tenantId': doc._id },
      { 'cosigners.tenantId': doc._id },
    ],
  })
    .sort({ startDate: 1 })
    .lean();

  const [propDocs, unitDocs] = await Promise.all([
    Property.find({
      organizationId: doc.organizationId,
      _id: { $in: tenantLeases.map((l) => l.propertyId) },
    })
      .select({ propertyName: 1 })
      .lean<{ _id: Types.ObjectId; propertyName?: string }[]>(),
    Unit.find({
      organizationId: doc.organizationId,
      _id: { $in: tenantLeases.map((l) => l.unitId) },
    })
      .select({ unitId: 1 })
      .lean<{ _id: Types.ObjectId; unitId?: string }[]>(),
  ]);
  const propName = new Map(propDocs.map((p) => [String(p._id), p.propertyName ?? '']));
  const unitName = new Map(unitDocs.map((u) => [String(u._id), u.unitId ?? '']));

  const allLeases = tenantLeases.map((l) => ({
    id: String(l._id),
    leaseNumber: l.leaseNumber,
    propertyName: propName.get(String(l.propertyId)) || '(Unknown property)',
    unitName: unitName.get(String(l.unitId)) || '(Unknown unit)',
    status: computeLeaseStatus({
      startDate: l.startDate,
      endDate: l.endDate ?? null,
      leaseType: l.leaseType,
      manual: l.status,
    }),
    leaseType: l.leaseType,
    startDate: l.startDate ?? null,
    endDate: l.endDate ?? null,
    primaryRentAmount: l.primaryRent?.amount ?? 0,
    totalRentAmount:
      (l.primaryRent?.amount ?? 0) +
      (l.splitRentCharges ?? []).reduce((s, c) => s + (c.amount ?? 0), 0),
    proportionateSharePct: l.proportionateSharePct ?? null,
    salesTaxRatePct: l.salesTaxRatePct ?? null,
    rentSchedule: (l.rentSchedule ?? []).map((p) => ({
      label: p.label,
      kind: p.kind,
      startDate: p.startDate,
      endDate: p.endDate,
      sizeSqft: p.sizeSqft ?? 0,
      baseRatePerSqft: p.baseRatePerSqft ?? 0,
      opexRatePerSqft: p.opexRatePerSqft ?? 0,
      taxRatePerSqft: p.taxRatePerSqft ?? 0,
      amounts: computePeriodAmounts(
        {
          sizeSqft: p.sizeSqft ?? 0,
          baseRatePerSqft: p.baseRatePerSqft ?? 0,
          opexRatePerSqft: p.opexRatePerSqft ?? 0,
          taxRatePerSqft: p.taxRatePerSqft ?? 0,
        },
        l.salesTaxRatePct ?? null,
      ),
    })),
  }));

  return NextResponse.json({
    id: String(doc._id),
    tenantType: doc.tenantType ?? 'Individual',
    firstName: doc.firstName,
    lastName: doc.lastName,
    companyName: doc.companyName ?? '',
    contactPersonName: doc.contactPersonName ?? '',
    displayName: tenantDisplayName(doc),
    email: doc.email ?? '',
    phones: doc.phones ?? {},
    address: doc.address ?? {},
    dateOfBirth: doc.dateOfBirth ?? null,
    ssnLast4: doc.ssnLast4 ?? '',
    cosignerFlag: doc.cosignerFlag,
    residentCenterAccess: doc.residentCenterAccess,
    customFields,
    active: doc.active,
    currentLeaseId: doc.currentLeaseId ? String(doc.currentLeaseId) : null,
    currentLease,
    allLeases,
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

  const prevType = doc.tenantType ?? 'Individual';
  const { dateOfBirth, customFields, ...rest } = parsed.data;
  Object.assign(doc, rest);
  if (dateOfBirth !== undefined) {
    doc.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }

  // §1 — when the caller explicitly converts the tenant's type, drop the
  // fields that belong to the *other* type so no stale value lingers (e.g. a
  // company name left over after Company ⇒ Individual, or a personal name left
  // over after Individual ⇒ Company). The edit-type modal sends only the new
  // type's fields; this guarantees a clean canonical doc that matches what the
  // Add flow would have produced for that type.
  const typeChanged =
    rest.tenantType !== undefined && rest.tenantType !== prevType;
  if (rest.tenantType !== undefined) {
    if (doc.tenantType === 'Company') {
      doc.firstName = '';
      doc.lastName = '';
    } else {
      doc.companyName = undefined;
      doc.contactPersonName = undefined;
    }
  }

  try {
    await doc.save();
  } catch (err) {
    // Surface the model's conditional-required hook (and any other schema
    // validation) as a clean 400 instead of a 500.
    const message = err instanceof Error ? err.message : 'Invalid tenant';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Keep the denormalized tenant snapshots embedded in leases / draft leases in
  // step with the canonical doc whenever an identity field changed — otherwise
  // the rent roll, lease detail, unit/property pages and compose-email picker
  // would keep showing the pre-edit name/type.
  const identityChanged = (
    ['tenantType', 'firstName', 'lastName', 'companyName', 'email'] as const
  ).some((k) => k in parsed.data);
  if (identityChanged) {
    await syncTenantSnapshots(doc);
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Tenant',
    parentId: doc._id,
    eventType: typeChanged ? 'Tenant type changed' : 'Tenant updated',
    actorUserId: ctx.userId,
    payload: typeChanged
      ? { from: prevType, to: doc.tenantType, name: tenantDisplayName(doc) }
      : undefined,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  // Two removal modes on one verb, mirroring the Bill delete route:
  //   • (default) archive   — reversible soft delete; the "Inactivate" action.
  //   • mode=permanent      — hard delete; wipes the tenant document for good.
  const mode =
    new URL(request.url).searchParams.get('mode') === 'permanent'
      ? 'permanent'
      : 'archive';

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (mode === 'archive') {
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

  // Permanent delete is a deliberate two-step: the tenant must be Inactivated
  // (reversible archive) first. Refuse to wipe a still-active tenant so the
  // irreversible action can never happen by accident from a live record.
  if (doc.active) {
    return NextResponse.json(
      {
        error:
          'This tenant is still active. Inactivate the tenant first, then delete it permanently.',
      },
      { status: 409 },
    );
  }

  // Secondary integrity guard: even once inactive, refuse while the tenant is
  // named on a live (Active or Future) lease, where a hard delete would orphan
  // the lease's tenant reference. Past/Ended/Cancelled leases keep their
  // point-in-time snapshot (syncTenantSnapshots) and do not block — mirrors the
  // Unit delete guard.
  const blockingLease = await Lease.findOne({
    organizationId: doc.organizationId,
    status: { $in: ['Active', 'Future'] },
    $or: [{ 'tenants.tenantId': doc._id }, { 'cosigners.tenantId': doc._id }],
  })
    .select({ leaseNumber: 1, status: 1 })
    .lean<{ leaseNumber: number; status: string } | null>();
  if (blockingLease) {
    return NextResponse.json(
      {
        error: `This tenant is named on lease #${blockingLease.leaseNumber} (${blockingLease.status}). End or cancel the lease before deleting the tenant.`,
      },
      { status: 409 },
    );
  }

  // Capture the display name before the document is gone so the audit line
  // (which outlives the tenant) still reads meaningfully.
  const name = tenantDisplayName(doc);
  await doc.deleteOne();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Tenant',
    parentId: doc._id,
    eventType: 'Tenant permanently deleted',
    actorUserId: ctx.userId,
    payload: { name },
  });

  return NextResponse.json({ ok: true, mode: 'permanent' });
}
