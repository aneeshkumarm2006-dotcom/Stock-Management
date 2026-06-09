// Per-row CRUD on DraftLease. GET surfaces a `conflict` payload when the unit
// is occupied (BR-LL-9). PATCH enforces the executionStatus transition rules
// (DECISIONS.md Phase 3) — Executed is one-way; Cancelled → Draft requires
// no promoted Lease.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { DraftLease } from '@/lib/db/models/pm/DraftLease';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Unit } from '@/lib/db/models/pm/Unit';
import type {
  EsignatureStatus,
  LeaseType,
  DraftLeaseExecutionStatus,
  RentCycle,
} from '@/types/pm';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  draftLeaseUpdateSchema,
  isValidDraftLeaseTransition,
} from '@/lib/validation/pm/draftLease';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import { rentCentsFromRateCents } from '@/lib/pm/rent';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return DraftLease.findOne({
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

  // BR-LL-9 — surface any Active/Future lease on the same unit.
  const conflict = await Lease.findOne({
    organizationId: doc.organizationId,
    unitId: doc.unitId,
    status: { $in: ['Active', 'Future'] },
  })
    .select({ _id: 1, leaseNumber: 1, status: 1 })
    .lean<{ _id: Types.ObjectId; leaseNumber: number; status: string } | null>();

  return NextResponse.json({
    id: String(doc._id),
    draftId: doc.draftId,
    signatureStatus: doc.signatureStatus,
    esignatureStatus: doc.esignatureStatus,
    executionStatus: doc.executionStatus,
    propertyId: String(doc.propertyId),
    unitId: String(doc.unitId),
    leaseType: doc.leaseType,
    startDate: doc.startDate ?? null,
    endDate: doc.endDate ?? null,
    leasingAgentUserId: doc.leasingAgentUserId
      ? String(doc.leasingAgentUserId)
      : null,
    approvedApplicants: (doc.approvedApplicants ?? []).map((a) => ({
      applicantId: String(a.applicantId),
      firstName: a.firstName,
      lastName: a.lastName,
    })),
    tenants: (doc.tenants ?? []).map((t) => ({
      tenantId: t.tenantId ? String(t.tenantId) : null,
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email ?? '',
      isCosigner: t.isCosigner,
    })),
    cosigners: (doc.cosigners ?? []).map((t) => ({
      tenantId: t.tenantId ? String(t.tenantId) : null,
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email ?? '',
      isCosigner: true,
    })),
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
    securityDeposit: doc.securityDeposit,
    recurringCharges: (doc.recurringCharges ?? []).map((c) => ({
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
      isMoveInCharge: c.isMoveInCharge,
      paidAt: c.paidAt ?? null,
    })),
    moveInCharges: (doc.moveInCharges ?? []).map((c) => ({
      id: String((c as { _id?: unknown })._id ?? ''),
      amount: c.amount,
      accountId: String(c.accountId),
      dueDate: c.dueDate ?? null,
      memo: c.memo ?? '',
      paidAt: c.paidAt ?? null,
      paidByApplicantId: c.paidByApplicantId
        ? String(c.paidByApplicantId)
        : null,
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
    recentNotes: doc.recentNotes ?? '',
    files: (doc.files ?? []).map((id) => String(id)),
    promotedToLeaseId: doc.promotedToLeaseId
      ? String(doc.promotedToLeaseId)
      : null,
    promotedAt: doc.promotedAt ?? null,
    cancelledAt: doc.cancelledAt ?? null,
    conflict: conflict
      ? {
          leaseId: String(conflict._id),
          leaseNumber: conflict.leaseNumber,
          status: conflict.status,
        }
      : null,
    canExecute:
      doc.executionStatus === 'Ready to execute' &&
      (doc.moveInCharges ?? []).every((c) => c.paidAt),
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
  const parsed = draftLeaseUpdateSchema.safeParse(body);
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
    startDate,
    endDate,
    leaseType,
    primaryRent,
    splitRentCharges,
    securityDeposit,
    recurringCharges,
    oneTimeCharges,
    moveInCharges,
    lateFeePolicy,
    esignatureDocuments,
    files,
    approvedApplicants,
    tenants,
    cosigners,
    leasingAgentUserId,
    customFields,
    signatureStatus,
    esignatureStatus,
    executionStatus,
    ...rest
  } = parsed.data;

  // Transition gate.
  if (executionStatus !== undefined && executionStatus !== doc.executionStatus) {
    if (!isValidDraftLeaseTransition(doc.executionStatus, executionStatus)) {
      return NextResponse.json(
        {
          error: `Invalid executionStatus transition: ${doc.executionStatus} → ${executionStatus}`,
        },
        { status: 400 },
      );
    }
    // [G-B-1] — Cancelled → Draft requires no promoted Lease.
    if (
      doc.executionStatus === 'Cancelled' &&
      executionStatus === 'Draft' &&
      doc.promotedToLeaseId
    ) {
      return NextResponse.json(
        {
          error:
            'Cannot re-open a draft that has already been promoted to a lease.',
        },
        { status: 409 },
      );
    }
    // Executing via PATCH is disallowed — the /execute route owns that path.
    if (executionStatus === 'Executed') {
      return NextResponse.json(
        {
          error:
            'Use POST /draft-leases/:id/execute to execute the lease.',
        },
        { status: 400 },
      );
    }
    doc.executionStatus = executionStatus as DraftLeaseExecutionStatus;
  }

  Object.assign(doc, rest);
  if (signatureStatus !== undefined) {
    doc.signatureStatus = signatureStatus as EsignatureStatus;
  }
  if (esignatureStatus !== undefined) {
    doc.esignatureStatus = esignatureStatus as EsignatureStatus;
    // Mirror the [G-B-5] "Generate offer" semantics — flipping to Sent also
    // moves executionStatus along when still in Draft.
    if (
      esignatureStatus === 'Sent' &&
      doc.executionStatus === 'Draft'
    ) {
      doc.executionStatus = 'Out for signature';
    }
  }
  if (propertyId !== undefined) doc.propertyId = new Types.ObjectId(propertyId);
  if (unitId !== undefined) doc.unitId = new Types.ObjectId(unitId);
  if (leaseType !== undefined) doc.leaseType = leaseType as LeaseType;
  if (startDate !== undefined) {
    doc.startDate = startDate ? new Date(startDate) : null;
  }
  if (endDate !== undefined) doc.endDate = endDate ? new Date(endDate) : null;
  if (leasingAgentUserId !== undefined) {
    doc.leasingAgentUserId = leasingAgentUserId
      ? new Types.ObjectId(leasingAgentUserId)
      : null;
  }
  if (primaryRent !== undefined) {
    // §3 — store method + rate; best-effort resolve the amount against the
    // (possibly just-updated) unit's sizeSqft. Drafts are lenient: a missing
    // sizeSqft just yields amount 0; execute does the authoritative recompute.
    const rentMethod =
      primaryRent.rentMethod === 'RatePerSqft' ? 'RatePerSqft' : 'Fixed';
    let amountCents = toCents(primaryRent.amount ?? 0);
    let ratePerSqftCents = 0;
    if (rentMethod === 'RatePerSqft') {
      ratePerSqftCents = toCents(primaryRent.ratePerSqft ?? 0);
      const unit = await Unit.findOne({
        _id: doc.unitId,
        organizationId: doc.organizationId,
      })
        .select({ sizeSqft: 1 })
        .lean<{ sizeSqft?: number } | null>();
      amountCents = rentCentsFromRateCents(ratePerSqftCents, unit?.sizeSqft ?? 0);
    }
    doc.primaryRent = {
      amount: amountCents,
      accountId: primaryRent.accountId
        ? new Types.ObjectId(primaryRent.accountId)
        : (null as unknown as Types.ObjectId),
      rentMethod,
      ratePerSqftCents,
      nextDueDate: primaryRent.nextDueDate ? new Date(primaryRent.nextDueDate) : null,
      memo: primaryRent.memo,
    };
  }
  if (splitRentCharges !== undefined) {
    doc.splitRentCharges = splitRentCharges.map((c) => ({
      accountId: c.accountId
        ? new Types.ObjectId(c.accountId)
        : (null as unknown as Types.ObjectId),
      amount: toCents(c.amount ?? 0),
      memo: c.memo,
    }));
  }
  if (securityDeposit !== undefined) {
    doc.securityDeposit = toCents(securityDeposit);
  }
  if (recurringCharges !== undefined) {
    doc.recurringCharges = recurringCharges.map((c) => ({
      amount: toCents(c.amount ?? 0),
      accountId: c.accountId
        ? new Types.ObjectId(c.accountId)
        : (null as unknown as Types.ObjectId),
      frequency: (c.frequency ?? 'Monthly') as RentCycle,
      nextDate: c.nextDate ? new Date(c.nextDate) : null,
      memo: c.memo,
      postNDaysInAdvance: c.postNDaysInAdvance ?? 5,
    }));
  }
  if (oneTimeCharges !== undefined) {
    doc.oneTimeCharges = oneTimeCharges.map((c) => ({
      amount: toCents(c.amount ?? 0),
      accountId: c.accountId
        ? new Types.ObjectId(c.accountId)
        : (null as unknown as Types.ObjectId),
      dueDate: c.dueDate ? new Date(c.dueDate) : null,
      memo: c.memo,
      isMoveInCharge: c.isMoveInCharge ?? false,
      paidAt: null,
      paidByApplicantId: null,
    }));
  }
  if (moveInCharges !== undefined) {
    doc.moveInCharges = moveInCharges.map((c) => ({
      amount: toCents(c.amount ?? 0),
      accountId: c.accountId
        ? new Types.ObjectId(c.accountId)
        : (null as unknown as Types.ObjectId),
      dueDate: c.dueDate ? new Date(c.dueDate) : null,
      memo: c.memo,
      isMoveInCharge: true,
      paidAt: null,
      paidByApplicantId: null,
    }));
  }
  if (lateFeePolicy !== undefined) {
    doc.lateFeePolicy = { enabled: false, ...lateFeePolicy };
  }
  if (esignatureDocuments !== undefined) {
    doc.esignatureDocuments = esignatureDocuments.map((d) => ({
      fileId: d.fileId ? new Types.ObjectId(d.fileId) : null,
      role: d.role ?? 'Lease',
      label: d.label ?? '',
      status: (d.status ?? 'Not sent') as EsignatureStatus,
      sentAt: null,
      signedAt: null,
    }));
  }
  if (files !== undefined) {
    doc.files = files.map((id) => new Types.ObjectId(id));
  }
  if (approvedApplicants !== undefined) {
    doc.approvedApplicants = approvedApplicants.map((a) => ({
      applicantId: new Types.ObjectId(a.applicantId),
      firstName: a.firstName ?? '',
      lastName: a.lastName ?? '',
    }));
  }
  if (tenants !== undefined) {
    doc.tenants = tenants.map((t) => ({
      tenantId: t.tenantId ? new Types.ObjectId(t.tenantId) : null,
      firstName: t.firstName ?? '',
      lastName: t.lastName ?? '',
      email: t.email,
      isCosigner: t.isCosigner ?? false,
    }));
  }
  if (cosigners !== undefined) {
    doc.cosigners = cosigners.map((t) => ({
      tenantId: t.tenantId ? new Types.ObjectId(t.tenantId) : null,
      firstName: t.firstName ?? '',
      lastName: t.lastName ?? '',
      email: t.email,
      isCosigner: true,
    }));
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'DraftLease',
    parentId: doc._id,
    eventType: 'Draft lease updated',
    actorUserId: ctx.userId,
    payload: executionStatus ? { executionStatus } : undefined,
  });

  return NextResponse.json({ ok: true });
}
