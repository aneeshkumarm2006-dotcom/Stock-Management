// Per-row CRUD on Lease.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  Lease,
  currentDepositHeld,
} from '@/lib/db/models/pm/Lease';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import type {
  EsignatureStatus,
  LeaseStatus,
  LeaseType,
  RentCycle,
} from '@/types/pm';
import { RentersInsurancePolicy } from '@/lib/db/models/pm/RentersInsurancePolicy';
import { Pet } from '@/lib/db/models/pm/Pet';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { leaseUpdateSchema } from '@/lib/validation/pm/lease';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import {
  computeLeaseStatus,
  daysRemaining,
  recomputeLeaseStatuses,
} from '@/lib/pm/leaseStatus';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Lease.findOne({
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

  const [insurancePolicies, pets] = await Promise.all([
    RentersInsurancePolicy.find({
      organizationId: doc.organizationId,
      leaseId: doc._id,
    }).lean(),
    Pet.find({
      organizationId: doc.organizationId,
      leaseId: doc._id,
    }).lean(),
  ]);

  // BR-LL-6 — uninsuredResidents = lease.tenants where every covered policy
  // explicitly excludes them. Empty `coveredResidents` array means
  // "everyone covered".
  const insuredTenantIds = new Set<string>();
  for (const p of insurancePolicies) {
    if (!p.coveredResidents || p.coveredResidents.length === 0) {
      for (const t of doc.tenants) insuredTenantIds.add(String(t.tenantId));
    } else {
      for (const r of p.coveredResidents) insuredTenantIds.add(String(r));
    }
  }
  const uninsuredResidents = doc.tenants
    .filter((t) => !insuredTenantIds.has(String(t.tenantId)))
    .map((t) => ({
      tenantId: String(t.tenantId),
      firstName: t.firstName,
      lastName: t.lastName,
    }));

  return NextResponse.json({
    id: String(doc._id),
    leaseNumber: doc.leaseNumber,
    propertyId: String(doc.propertyId),
    unitId: String(doc.unitId),
    rentalOwnerId: doc.rentalOwnerId ? String(doc.rentalOwnerId) : null,
    tenants: doc.tenants.map((t) => ({
      tenantId: String(t.tenantId),
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email ?? '',
      isCosigner: t.isCosigner,
    })),
    cosigners: doc.cosigners.map((t) => ({
      tenantId: String(t.tenantId),
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email ?? '',
      isCosigner: true,
    })),
    leaseType: doc.leaseType,
    startDate: doc.startDate,
    endDate: doc.endDate ?? null,
    status: doc.status,
    derivedStatus: computeLeaseStatus({
      startDate: doc.startDate,
      endDate: doc.endDate ?? null,
      leaseType: doc.leaseType,
      manual: doc.status,
    }),
    evictionPending: doc.evictionPending,
    evictionPendingNote: doc.evictionPendingNote ?? '',
    daysRemaining: daysRemaining({
      endDate: doc.endDate ?? null,
      leaseType: doc.leaseType,
    }),
    rentCycle: doc.rentCycle,
    primaryRent: {
      amount: doc.primaryRent.amount,
      accountId: String(doc.primaryRent.accountId),
      nextDueDate: doc.primaryRent.nextDueDate ?? null,
      memo: doc.primaryRent.memo ?? '',
    },
    splitRentCharges: (doc.splitRentCharges ?? []).map((c) => ({
      accountId: String(c.accountId),
      amount: c.amount,
      memo: c.memo ?? '',
    })),
    securityDeposit: {
      received: doc.securityDeposit?.received ?? 0,
      withheld: doc.securityDeposit?.withheld ?? 0,
      refunded: doc.securityDeposit?.refunded ?? 0,
      held: currentDepositHeld(doc.securityDeposit ?? {
        received: 0,
        withheld: 0,
        refunded: 0,
      }),
    },
    recurringCharges: (doc.recurringCharges ?? []).map((c) => ({
      id: String((c as { _id?: unknown })._id ?? ''),
      amount: c.amount,
      accountId: String(c.accountId),
      frequency: c.frequency,
      nextDate: c.nextDate ?? null,
      memo: c.memo ?? '',
      postNDaysInAdvance: c.postNDaysInAdvance,
    })),
    oneTimeCharges: (doc.oneTimeCharges ?? []).map((c) => ({
      id: String((c as { _id?: unknown })._id ?? ''),
      amount: c.amount,
      accountId: String(c.accountId),
      dueDate: c.dueDate ?? null,
      memo: c.memo ?? '',
      posted: c.posted,
      postedAt: c.postedAt ?? null,
    })),
    lateFeePolicy: doc.lateFeePolicy ?? { enabled: false },
    residentCenterWelcomeEmail: doc.residentCenterWelcomeEmail,
    esignatureDocuments: (doc.esignatureDocuments ?? []).map((d) => ({
      id: String((d as { _id?: unknown })._id ?? ''),
      fileId: d.fileId ? String(d.fileId) : null,
      role: d.role,
      label: d.label,
      status: d.status,
      sentAt: d.sentAt ?? null,
      signedAt: d.signedAt ?? null,
    })),
    comments: doc.comments ?? '',
    files: (doc.files ?? []).map((id) => String(id)),
    promotedFromDraftLeaseId: doc.promotedFromDraftLeaseId
      ? String(doc.promotedFromDraftLeaseId)
      : null,
    rentersInsurancePolicies: insurancePolicies.map((p) => ({
      id: String(p._id),
      carrier: p.carrier,
      policyNumber: p.policyNumber ?? '',
      liabilityCoverage: p.liabilityCoverage,
      effectiveDate: p.effectiveDate,
      expirationDate: p.expirationDate,
      coveredResidents: (p.coveredResidents ?? []).map((id) => String(id)),
    })),
    uninsuredResidents,
    pets: pets.map((p) => ({
      id: String(p._id),
      name: p.name,
      petType: p.petType,
      breed: p.breed ?? '',
      weightLbs: p.weightLbs ?? null,
      ageYears: p.ageYears ?? null,
      licenseNumber: p.licenseNumber ?? '',
      assistanceAnimal: p.assistanceAnimal,
      ownerTenantId: p.ownerTenantId ? String(p.ownerTenantId) : null,
    })),
    customFields: doc.customFields instanceof Map
      ? Object.fromEntries(doc.customFields)
      : doc.customFields ?? {},
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
  const parsed = leaseUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const {
    propertyId,
    unitId,
    rentalOwnerId,
    tenants,
    cosigners,
    startDate,
    endDate,
    leaseType,
    primaryRent,
    splitRentCharges,
    securityDepositReceived,
    recurringCharges,
    oneTimeCharges,
    lateFeePolicy,
    esignatureDocuments,
    files,
    status,
    customFields,
    evictionPending,
    evictionPendingNote,
    ...rest
  } = parsed.data;

  Object.assign(doc, rest);
  if (propertyId !== undefined) doc.propertyId = new Types.ObjectId(propertyId);
  if (unitId !== undefined) doc.unitId = new Types.ObjectId(unitId);
  if (rentalOwnerId !== undefined) {
    doc.rentalOwnerId = rentalOwnerId
      ? new Types.ObjectId(rentalOwnerId)
      : null;
  }
  if (tenants !== undefined) {
    doc.tenants = tenants.map((t) => ({
      tenantId: new Types.ObjectId(t.tenantId),
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      isCosigner: t.isCosigner ?? false,
    }));
  }
  if (cosigners !== undefined) {
    doc.cosigners = cosigners.map((t) => ({
      tenantId: new Types.ObjectId(t.tenantId),
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      isCosigner: true,
    }));
  }
  if (startDate !== undefined) doc.startDate = new Date(startDate);
  if (endDate !== undefined) doc.endDate = endDate ? new Date(endDate) : null;
  if (leaseType !== undefined) doc.leaseType = leaseType as LeaseType;
  if (primaryRent !== undefined) {
    doc.primaryRent = {
      amount: toCents(primaryRent.amount),
      accountId: new Types.ObjectId(primaryRent.accountId),
      nextDueDate: primaryRent.nextDueDate ? new Date(primaryRent.nextDueDate) : null,
      memo: primaryRent.memo,
    };
  }
  if (splitRentCharges !== undefined) {
    doc.splitRentCharges = splitRentCharges.map((c) => ({
      accountId: new Types.ObjectId(c.accountId),
      amount: toCents(c.amount),
      memo: c.memo,
    }));
  }
  if (securityDepositReceived !== undefined) {
    doc.securityDeposit.received = toCents(securityDepositReceived);
  }
  if (recurringCharges !== undefined) {
    doc.recurringCharges = recurringCharges.map((c) => ({
      amount: toCents(c.amount),
      accountId: new Types.ObjectId(c.accountId),
      frequency: c.frequency as RentCycle,
      nextDate: c.nextDate ? new Date(c.nextDate) : null,
      memo: c.memo,
      postNDaysInAdvance: c.postNDaysInAdvance ?? 5,
    }));
  }
  if (oneTimeCharges !== undefined) {
    doc.oneTimeCharges = oneTimeCharges.map((c) => ({
      amount: toCents(c.amount),
      accountId: new Types.ObjectId(c.accountId),
      dueDate: c.dueDate ? new Date(c.dueDate) : null,
      memo: c.memo,
      posted: false,
      postedAt: null,
    }));
  }
  if (lateFeePolicy !== undefined) {
    doc.lateFeePolicy = { enabled: false, ...lateFeePolicy };
  }
  if (esignatureDocuments !== undefined) {
    doc.esignatureDocuments = esignatureDocuments.map((d) => ({
      fileId: d.fileId ? new Types.ObjectId(d.fileId) : null,
      role: d.role ?? 'Lease',
      label: d.label,
      status: (d.status ?? 'Completed') as EsignatureStatus,
      sentAt: null,
      signedAt: null,
    }));
  }
  if (files !== undefined) {
    doc.files = files.map((id) => new Types.ObjectId(id));
  }
  if (evictionPending !== undefined) doc.evictionPending = evictionPending;
  if (evictionPendingNote !== undefined) {
    doc.evictionPendingNote = evictionPendingNote;
  }
  if (status !== undefined) doc.status = status as LeaseStatus;
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  await doc.save();

  // "End lease / Move out": a terminal status frees the tenants' pointer.
  // recomputeLeaseStatuses only scans Active/Future/Expired, so a just-ended
  // lease must be cleared explicitly here.
  if (status === 'Ended' || status === 'Cancelled') {
    await Tenant.updateMany(
      {
        organizationId: doc.organizationId,
        _id: { $in: doc.tenants.map((t) => t.tenantId) },
        currentLeaseId: doc._id,
      },
      { $set: { currentLeaseId: null } },
    );
  }
  if (status !== undefined) {
    await recomputeLeaseStatuses(ctx.orgId);
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Lease',
    parentId: doc._id,
    eventType: 'Lease updated',
    actorUserId: ctx.userId,
    payload: status ? { newStatus: status } : undefined,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  // DEL-010 — DELETE had no authorization or safety guard. Gate behind
  // Admin/PropertyManager, then refuse to cancel an Active lease that still
  // holds money or has charges that haven't been posted yet, unless the caller
  // explicitly confirms (the `confirm` flag in the body).
  const canCancel =
    ctx.roles.includes('Admin') || ctx.roles.includes('PropertyManager');
  if (!canCancel) {
    return NextResponse.json(
      { error: 'Only Admin or PropertyManager can cancel leases' },
      { status: 403 },
    );
  }

  let confirm = false;
  try {
    const body = (await request.json()) as { confirm?: unknown } | null;
    confirm = body?.confirm === true;
  } catch {
    // No/invalid body — treat as unconfirmed.
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.status === 'Active' && !confirm) {
    const depositHeld = currentDepositHeld(
      doc.securityDeposit ?? { received: 0, withheld: 0, refunded: 0 },
    );
    // "Unposted recurring charges" = a recurring charge whose nextDate is due
    // now or in the past (it would still fire on the next posting run).
    const now = Date.now();
    const hasUnpostedRecurring = (doc.recurringCharges ?? []).some(
      (c) => c.nextDate && c.nextDate.getTime() <= now,
    );
    if (depositHeld > 0 || hasUnpostedRecurring) {
      return NextResponse.json(
        {
          error:
            'Active lease has a held security deposit or unposted recurring charges. Resolve them or resend with { "confirm": true } to cancel anyway.',
          securityDepositHeld: depositHeld,
          hasUnpostedRecurring,
        },
        { status: 409 },
      );
    }
  }

  doc.status = 'Cancelled';
  await doc.save();
  // Free the tenants' currentLeaseId pointer (consistency with PATCH terminate).
  await Tenant.updateMany(
    {
      organizationId: doc.organizationId,
      _id: { $in: doc.tenants.map((t) => t.tenantId) },
      currentLeaseId: doc._id,
    },
    { $set: { currentLeaseId: null } },
  );
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Lease',
    parentId: doc._id,
    eventType: 'Lease cancelled',
    actorUserId: ctx.userId,
    payload: confirm ? { confirmed: true } : undefined,
  });
  return NextResponse.json({ ok: true });
}
