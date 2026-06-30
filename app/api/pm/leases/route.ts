// Lease CRUD (PDR §3.3). The list view defaults to BR-LL-2 filter
// `(2) Active, Future`. POST is the data-import path — most leases come into
// existence via /draft-leases/[id]/execute.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Property } from '@/lib/db/models/pm/Property';
import { Unit } from '@/lib/db/models/pm/Unit';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { leaseCreateSchema } from '@/lib/validation/pm/lease';
import {
  mapRentScheduleToModel,
  deriveCurrentRentFromSchedule,
} from '@/lib/validation/pm/rentSchedule';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import { resolveRent, RentResolutionError } from '@/lib/pm/rent';
import { LEASE_STATUSES } from '@/types/pm';
import type { LeaseType, RentCycle } from '@/types/pm';
import {
  computeLeaseStatus,
  daysRemaining,
  recomputeLeaseStatuses,
} from '@/lib/pm/leaseStatus';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  const propertyId = searchParams.get('propertyId');
  const evictionParam = searchParams.get('eviction');

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (statusParam) {
    const list = statusParam
      .split(',')
      .filter((v) => (LEASE_STATUSES as readonly string[]).includes(v));
    if (list.length > 0) filter.status = { $in: list };
  } else {
    // BR-LL-2 default.
    filter.status = { $in: ['Active', 'Future'] };
  }
  if (propertyId && Types.ObjectId.isValid(propertyId)) {
    filter.propertyId = new Types.ObjectId(propertyId);
  }
  if (evictionParam === '1') filter.evictionPending = true;

  const rows = await Lease.find(filter)
    .sort({ status: 1, startDate: -1 })
    .lean();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      leaseNumber: r.leaseNumber,
      propertyId: String(r.propertyId),
      unitId: String(r.unitId),
      tenants: (r.tenants ?? []).map((t) => ({
        tenantId: String(t.tenantId),
        tenantType: t.tenantType ?? 'Individual',
        firstName: t.firstName,
        lastName: t.lastName,
        companyName: t.companyName ?? '',
      })),
      leaseType: r.leaseType,
      startDate: r.startDate,
      endDate: r.endDate ?? null,
      status: r.status,
      evictionPending: r.evictionPending,
      evictionPendingNote: r.evictionPendingNote ?? '',
      rentCycle: r.rentCycle,
      primaryRentAmount: r.primaryRent?.amount ?? 0,
      // §4 — total monthly rent = Base Rent (primaryRent) + the OPEX/Tax
      // recovery splits. Lets the rent roll show the full charge while
      // `primaryRentAmount` still exposes the base-only figure.
      totalRentAmount:
        (r.primaryRent?.amount ?? 0) +
        (r.splitRentCharges ?? []).reduce((s, c) => s + (c.amount ?? 0), 0),
      securityDepositReceived: r.securityDeposit?.received ?? 0,
      securityDepositHeld:
        (r.securityDeposit?.received ?? 0) -
        (r.securityDeposit?.withheld ?? 0) -
        (r.securityDeposit?.refunded ?? 0),
      daysRemaining: daysRemaining({
        endDate: r.endDate ?? null,
        leaseType: r.leaseType,
      }),
      derivedStatus: computeLeaseStatus({
        startDate: r.startDate,
        endDate: r.endDate ?? null,
        leaseType: r.leaseType,
        manual: r.status,
      }),
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
  const parsed = leaseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);

  // Reconcile persisted lease `status` + `Tenant.currentLeaseId` BEFORE the
  // guards below read them. Lease expiry is time-driven (deriveLeaseStatus),
  // but the persisted values only refresh on a lease write — the nightly
  // reconcile cron is the durable fix, yet a lease that lapsed since the last
  // write still carries a stale `Active` status / dangling `currentLeaseId`.
  // Without this, the occupancy / already-assigned guards would falsely 409 a
  // unit or tenant whose lease has actually expired. Idempotent and cheap
  // relative to the assignment it gates; never let a sync hiccup block create.
  try {
    await recomputeLeaseStatuses(ctx.orgId);
  } catch (syncErr) {
    console.error('recomputeLeaseStatuses before lease create failed', syncErr);
  }

  // ── FK existence + assignment guards ────────────────────────────────────
  // POST is the direct-create path (most leases arrive via draft-lease
  // execute). It previously trusted the body blindly; assigning an existing
  // tenant from the UI goes through here, so validate the references and
  // protect the one-live-lease-per-unit / one-active-lease-per-tenant rules.
  const propertyObjectId = new Types.ObjectId(parsed.data.propertyId);
  const unitObjectId = new Types.ObjectId(parsed.data.unitId);

  const property = await Property.findOne({
    _id: propertyObjectId,
    organizationId: orgId,
  })
    .select({ _id: 1 })
    .lean();
  if (!property) {
    return NextResponse.json(
      { error: 'propertyId does not reference a property in this org' },
      { status: 400 },
    );
  }

  const unit = await Unit.findOne({
    _id: unitObjectId,
    organizationId: orgId,
    propertyId: propertyObjectId,
  })
    .select({ _id: 1, sizeSqft: 1 })
    .lean<{ _id: Types.ObjectId; sizeSqft?: number } | null>();
  if (!unit) {
    return NextResponse.json(
      { error: 'unitId does not reference a unit on this property' },
      { status: 400 },
    );
  }

  // §3 — resolve the monthly rent: Fixed flat amount, or rate × unit sizeSqft.
  // Persist the RESOLVED cents into primaryRent.amount so no downstream reader
  // learns the formula. Rejects a RatePerSqft lease whose unit has no sizeSqft.
  let resolvedRent;
  try {
    resolvedRent = resolveRent({
      rentMethod: parsed.data.primaryRent.rentMethod,
      amount: parsed.data.primaryRent.amount,
      ratePerSqft: parsed.data.primaryRent.ratePerSqft,
      sizeSqft: unit.sizeSqft ?? null,
    });
  } catch (err) {
    if (err instanceof RentResolutionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const tenantRefs = [
    ...parsed.data.tenants,
    ...(parsed.data.cosigners ?? []),
  ];
  const uniqueTenantIds = Array.from(
    new Map(
      tenantRefs.map((t) => [t.tenantId, new Types.ObjectId(t.tenantId)]),
    ).values(),
  );
  const foundTenants = await Tenant.find({
    _id: { $in: uniqueTenantIds },
    organizationId: orgId,
  })
    .select({ _id: 1, firstName: 1, lastName: 1, currentLeaseId: 1 })
    .lean<
      {
        _id: Types.ObjectId;
        firstName: string;
        lastName: string;
        currentLeaseId?: unknown;
      }[]
    >();
  if (foundTenants.length !== uniqueTenantIds.length) {
    return NextResponse.json(
      { error: 'One or more tenants do not exist in this org' },
      { status: 400 },
    );
  }

  // No double-booking: a unit carries at most one live (Active/Future) lease.
  const occupying = await Lease.findOne({
    organizationId: orgId,
    unitId: unitObjectId,
    status: { $in: ['Active', 'Future'] },
  })
    .select({ leaseNumber: 1 })
    .lean<{ leaseNumber: number } | null>();
  if (occupying) {
    return NextResponse.json(
      {
        error: `Unit already has an active or future lease (#${occupying.leaseNumber}). End it before assigning a new tenant.`,
      },
      { status: 409 },
    );
  }

  // A tenant holds only one active assignment (Tenant.currentLeaseId is single).
  const alreadyAssigned = foundTenants.find((t) => Boolean(t.currentLeaseId));
  if (alreadyAssigned) {
    return NextResponse.json(
      {
        error: `${alreadyAssigned.firstName} ${alreadyAssigned.lastName} is already assigned to a property. Move them out first.`,
      },
      { status: 409 },
    );
  }
  // ────────────────────────────────────────────────────────────────────────

  const last = await Lease.findOne({ organizationId: orgId })
    .sort({ leaseNumber: -1 })
    .select({ leaseNumber: 1 })
    .lean<{ leaseNumber: number } | null>();
  const leaseNumber = (last?.leaseNumber ?? 0) + 1;

  // Commercial rent-escalation schedule (optional). When present, it DRIVES GL
  // posting by date and we keep `primaryRent`/`splitRentCharges` synced to the
  // CURRENT period so the rent roll / financials show the right current rent.
  const rentScheduleModel = mapRentScheduleToModel(parsed.data.rentSchedule);
  const derivedRent = deriveCurrentRentFromSchedule(rentScheduleModel, new Date());

  try {
    const doc = await Lease.create({
      organizationId: orgId,
      leaseNumber,
      propertyId: new Types.ObjectId(parsed.data.propertyId),
      unitId: new Types.ObjectId(parsed.data.unitId),
      rentalOwnerId: parsed.data.rentalOwnerId
        ? new Types.ObjectId(parsed.data.rentalOwnerId)
        : null,
      tenants: parsed.data.tenants.map((t) => ({
        tenantId: new Types.ObjectId(t.tenantId),
        tenantType: t.tenantType ?? 'Individual',
        firstName: t.firstName ?? '',
        lastName: t.lastName ?? '',
        companyName: t.companyName,
        email: t.email,
        isCosigner: t.isCosigner ?? false,
      })),
      cosigners: (parsed.data.cosigners ?? []).map((t) => ({
        tenantId: new Types.ObjectId(t.tenantId),
        tenantType: t.tenantType ?? 'Individual',
        firstName: t.firstName ?? '',
        lastName: t.lastName ?? '',
        companyName: t.companyName,
        email: t.email,
        isCosigner: true,
      })),
      leaseType: parsed.data.leaseType as LeaseType,
      startDate: new Date(parsed.data.startDate),
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      status: computeLeaseStatus({
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate ?? null,
        leaseType: parsed.data.leaseType as LeaseType,
      }),
      evictionPending: false,
      rentCycle: (parsed.data.rentCycle ?? 'Monthly') as RentCycle,
      primaryRent: {
        // When a schedule is present its current period is authoritative for the
        // resolved snapshot; otherwise use the form's single rent (§3).
        amount: derivedRent ? derivedRent.amount : resolvedRent.amountCents,
        accountId: derivedRent
          ? derivedRent.accountId
          : new Types.ObjectId(parsed.data.primaryRent.accountId),
        rentMethod: derivedRent ? 'Fixed' : resolvedRent.rentMethod,
        ratePerSqftCents: derivedRent ? 0 : resolvedRent.ratePerSqftCents,
        nextDueDate: parsed.data.primaryRent.nextDueDate
          ? new Date(parsed.data.primaryRent.nextDueDate)
          : null,
        memo: derivedRent ? derivedRent.memo : parsed.data.primaryRent.memo,
      },
      splitRentCharges: derivedRent
        ? derivedRent.splitRentCharges
        : (parsed.data.splitRentCharges ?? []).map((c) => ({
            accountId: new Types.ObjectId(c.accountId),
            amount: toCents(c.amount),
            memo: c.memo,
          })),
      rentSchedule: rentScheduleModel,
      proportionateSharePct: parsed.data.proportionateSharePct,
      salesTaxRatePct: parsed.data.salesTaxRatePct,
      securityDeposit: {
        received: toCents(parsed.data.securityDepositReceived ?? 0),
        withheld: 0,
        refunded: 0,
      },
      recurringCharges: (parsed.data.recurringCharges ?? []).map((c) => ({
        amount: toCents(c.amount),
        accountId: new Types.ObjectId(c.accountId),
        frequency: c.frequency as RentCycle,
        nextDate: c.nextDate ? new Date(c.nextDate) : null,
        memo: c.memo,
        postNDaysInAdvance: c.postNDaysInAdvance ?? 5,
      })),
      oneTimeCharges: (parsed.data.oneTimeCharges ?? []).map((c) => ({
        amount: toCents(c.amount),
        accountId: new Types.ObjectId(c.accountId),
        dueDate: c.dueDate ? new Date(c.dueDate) : null,
        memo: c.memo,
        posted: false,
        postedAt: null,
      })),
      lateFeePolicy: { enabled: false, ...(parsed.data.lateFeePolicy ?? {}) },
      residentCenterWelcomeEmail:
        parsed.data.residentCenterWelcomeEmail ?? false,
      esignatureDocuments: (parsed.data.esignatureDocuments ?? []).map(
        (d) => ({
          fileId: d.fileId ? new Types.ObjectId(d.fileId) : null,
          role: d.role ?? 'Lease',
          label: d.label,
          status: (d.status ?? 'Completed') as import('@/types/pm').EsignatureStatus,
          sentAt: null,
          signedAt: null,
        }),
      ),
      comments: parsed.data.comments,
      files: (parsed.data.files ?? []).map((id) => new Types.ObjectId(id)),
      customFields: parsed.data.customFields ?? {},
    });

    // Point Tenant.currentLeaseId at this lease when it is Active (idempotent;
    // leaves tenants on other Active leases untouched per the $or guard).
    // Never let a sync hiccup fail a successful create — the lease exists.
    try {
      await recomputeLeaseStatuses(ctx.orgId);
    } catch (syncErr) {
      console.error('recomputeLeaseStatuses after lease create failed', syncErr);
    }

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Lease',
      parentId: doc._id,
      eventType: 'Lease created (direct)',
      actorUserId: ctx.userId,
      payload: { leaseNumber },
    });

    return NextResponse.json(
      { id: String(doc._id), leaseNumber },
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create lease';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
