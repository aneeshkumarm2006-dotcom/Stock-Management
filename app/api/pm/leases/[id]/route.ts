// Per-row CRUD on Lease.
//
// CURRENCY. Every amount on a lease — rent, splits, deposits, charges — is
// denominated in the currency its PROPERTY books in; a lease has no currency of
// its own. The payload therefore carries one resolved top-level `currency` and
// the page wraps itself in <PmNativeCurrency renderNative> with it, which is
// what stops a US lease being FX-converted into a figure matching no document.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  Lease,
  currentDepositHeld,
} from '@/lib/db/models/pm/Lease';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import { Unit } from '@/lib/db/models/pm/Unit';
import { Property } from '@/lib/db/models/pm/Property';
import { Organization } from '@/lib/db/models/pm/Organization';
import type {
  EsignatureStatus,
  LeaseStatus,
  LeaseType,
  PmCurrency,
  RentCycle,
  TenantType,
} from '@/types/pm';
import { RentersInsurancePolicy } from '@/lib/db/models/pm/RentersInsurancePolicy';
import { Pet } from '@/lib/db/models/pm/Pet';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { leaseUpdateSchema } from '@/lib/validation/pm/lease';
import {
  mapRentScheduleToModel,
  deriveCurrentRentFromSchedule,
} from '@/lib/validation/pm/rentSchedule';
import { logActivity } from '@/lib/pm/activity';
import { toCents, resolvePropertyCurrency } from '@/lib/pm/currency';
import { resolveRent, RentResolutionError } from '@/lib/pm/rent';
import { computePeriodAmounts } from '@/lib/pm/rentSchedule';
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

  const [insurancePolicies, pets, property, org] = await Promise.all([
    RentersInsurancePolicy.find({
      organizationId: doc.organizationId,
      leaseId: doc._id,
    }).lean(),
    Pet.find({
      organizationId: doc.organizationId,
      leaseId: doc._id,
    }).lean(),
    Property.findOne({
      _id: doc.propertyId,
      organizationId: doc.organizationId,
    })
      .select({ currency: 1 })
      .lean<{ currency?: PmCurrency | null } | null>(),
    Organization.findById(doc.organizationId)
      .select({ defaultCurrency: 1 })
      .lean<{ defaultCurrency?: PmCurrency } | null>(),
  ]);

  // `Property.currency` is optional by design — undefined means "inherit the
  // org default" — so it is resolved here rather than read raw.
  const currency: PmCurrency = resolvePropertyCurrency(
    property?.currency,
    org?.defaultCurrency,
  );

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
      tenantType: t.tenantType ?? 'Individual',
      firstName: t.firstName,
      lastName: t.lastName,
      companyName: t.companyName ?? '',
    }));

  return NextResponse.json({
    id: String(doc._id),
    leaseNumber: doc.leaseNumber,
    propertyId: String(doc.propertyId),
    /** Booking currency of this lease's property — covers every amount below. */
    currency,
    unitId: String(doc.unitId),
    rentalOwnerId: doc.rentalOwnerId ? String(doc.rentalOwnerId) : null,
    tenants: doc.tenants.map((t) => ({
      tenantId: String(t.tenantId),
      tenantType: t.tenantType ?? 'Individual',
      firstName: t.firstName,
      lastName: t.lastName,
      companyName: t.companyName ?? '',
      email: t.email ?? '',
      isCosigner: t.isCosigner,
    })),
    cosigners: doc.cosigners.map((t) => ({
      tenantId: String(t.tenantId),
      tenantType: t.tenantType ?? 'Individual',
      firstName: t.firstName,
      lastName: t.lastName,
      companyName: t.companyName ?? '',
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
      rentMethod: doc.primaryRent.rentMethod ?? 'Fixed',
      ratePerSqftCents: doc.primaryRent.ratePerSqftCents ?? 0,
      nextDueDate: doc.primaryRent.nextDueDate ?? null,
      memo: doc.primaryRent.memo ?? '',
    },
    splitRentCharges: (doc.splitRentCharges ?? []).map((c) => ({
      accountId: String(c.accountId),
      amount: c.amount,
      memo: c.memo ?? '',
    })),
    // Commercial rent-escalation schedule. Each period carries its stored
    // MONTHLY amounts (cents) AND the derived totals so the client table can
    // render the "Lease Summary" without re-deriving the math.
    proportionateSharePct: doc.proportionateSharePct ?? null,
    salesTaxRatePct: doc.salesTaxRatePct ?? null,
    rentSchedule: (doc.rentSchedule ?? []).map((p) => ({
      label: p.label,
      kind: p.kind,
      leaseType: p.leaseType ?? 'Fixed',
      startDate: p.startDate,
      // Null on an open-ended At-will period.
      endDate: p.endDate ?? null,
      sizeSqft: p.sizeSqft ?? 0,
      baseMonthlyAmount: p.baseMonthlyAmount ?? 0,
      baseAccountId: p.baseAccountId ? String(p.baseAccountId) : null,
      opexMonthlyAmount: p.opexMonthlyAmount ?? 0,
      opexAccountId: p.opexAccountId ? String(p.opexAccountId) : null,
      taxMonthlyAmount: p.taxMonthlyAmount ?? 0,
      taxAccountId: p.taxAccountId ? String(p.taxAccountId) : null,
      amounts: computePeriodAmounts(
        {
          sizeSqft: p.sizeSqft ?? 0,
          baseMonthlyAmount: p.baseMonthlyAmount ?? 0,
          opexMonthlyAmount: p.opexMonthlyAmount ?? 0,
          taxMonthlyAmount: p.taxMonthlyAmount ?? 0,
        },
        doc.salesTaxRatePct ?? null,
      ),
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
    rentSchedule,
    proportionateSharePct,
    salesTaxRatePct,
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
      tenantType: (t.tenantType ?? 'Individual') as TenantType,
      firstName: t.firstName ?? '',
      lastName: t.lastName ?? '',
      companyName: t.companyName,
      email: t.email,
      isCosigner: t.isCosigner ?? false,
    }));
  }
  if (cosigners !== undefined) {
    doc.cosigners = cosigners.map((t) => ({
      tenantId: new Types.ObjectId(t.tenantId),
      tenantType: (t.tenantType ?? 'Individual') as TenantType,
      firstName: t.firstName ?? '',
      lastName: t.lastName ?? '',
      companyName: t.companyName,
      email: t.email,
      isCosigner: true,
    }));
  }
  if (startDate !== undefined) doc.startDate = new Date(startDate);
  if (endDate !== undefined) doc.endDate = endDate ? new Date(endDate) : null;
  if (leaseType !== undefined) doc.leaseType = leaseType as LeaseType;
  if (primaryRent !== undefined) {
    // §3 — resolve against the lease's (possibly just-updated) unit sizeSqft.
    let sizeSqft: number | null = null;
    if (primaryRent.rentMethod === 'RatePerSqft') {
      const unit = await Unit.findOne({
        _id: doc.unitId,
        organizationId: doc.organizationId,
      })
        .select({ sizeSqft: 1 })
        .lean<{ sizeSqft?: number } | null>();
      sizeSqft = unit?.sizeSqft ?? null;
    }
    let resolvedRent;
    try {
      resolvedRent = resolveRent({
        rentMethod: primaryRent.rentMethod,
        amount: primaryRent.amount,
        ratePerSqft: primaryRent.ratePerSqft,
        sizeSqft,
      });
    } catch (err) {
      if (err instanceof RentResolutionError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    doc.primaryRent = {
      amount: resolvedRent.amountCents,
      accountId: new Types.ObjectId(primaryRent.accountId),
      rentMethod: resolvedRent.rentMethod,
      ratePerSqftCents: resolvedRent.ratePerSqftCents,
      // `nextDueDate` is the rent-posting cursor (see rentCharge.ts). PRESERVE
      // it when the edit omits it — otherwise an unrelated rent-terms edit would
      // rewind the cursor and re-post already-charged periods. Only an explicit
      // value (or explicit null) in the payload changes it.
      nextDueDate:
        primaryRent.nextDueDate !== undefined
          ? primaryRent.nextDueDate
            ? new Date(primaryRent.nextDueDate)
            : null
          : doc.primaryRent?.nextDueDate ?? null,
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
  if (proportionateSharePct !== undefined) {
    doc.proportionateSharePct = proportionateSharePct;
  }
  if (salesTaxRatePct !== undefined) doc.salesTaxRatePct = salesTaxRatePct;
  if (rentSchedule !== undefined) {
    const model = mapRentScheduleToModel(rentSchedule);
    doc.rentSchedule = model;
    // Keep the resolved CURRENT period in primaryRent/splits so legacy readers
    // + the posting fallback stay correct; PRESERVE the posting cursor so a
    // schedule edit never rewinds it and re-posts a charged period.
    const derived = deriveCurrentRentFromSchedule(model, new Date());
    if (derived) {
      doc.primaryRent = {
        amount: derived.amount,
        accountId: derived.accountId,
        rentMethod: 'Fixed',
        ratePerSqftCents: 0,
        nextDueDate: doc.primaryRent?.nextDueDate ?? null,
        memo: derived.memo,
      };
      doc.splitRentCharges = derived.splitRentCharges;
    }
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
  } else if (
    tenants !== undefined &&
    doc.status === 'Active' &&
    doc.tenants.length > 0
  ) {
    // Tenants were (re)assigned on an ACTIVE lease — point each tenant's
    // currentLeaseId at THIS lease so the link shows on the tenant record + rent
    // roll. Fixes attaching a tenant to a previously tenant-less lease (the
    // "(tenant)" placeholder case): without this the newly-attached tenant still
    // read as "Not assigned".
    //
    // Two guards mirror recomputeLeaseStatuses so this can't corrupt the pointer:
    //   • status === 'Active' only — currentLeaseId means "the Active lease the
    //     tenant lives on", so never point it at a Future/Expired lease.
    //   • $or filter — only claim a tenant that isn't already owned by a
    //     DIFFERENT lease, so assigning a tenant here never silently steals them
    //     away from another active lease they're still on.
    await Tenant.updateMany(
      {
        organizationId: doc.organizationId,
        _id: { $in: doc.tenants.map((t) => t.tenantId) },
        $or: [
          { currentLeaseId: null },
          { currentLeaseId: { $exists: false } },
          { currentLeaseId: doc._id },
        ],
      },
      { $set: { currentLeaseId: doc._id } },
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
