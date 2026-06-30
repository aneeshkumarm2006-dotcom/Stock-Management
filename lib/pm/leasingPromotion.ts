// Leasing promotion state machine (Phase 3). Centralises the three one-way
// transitions the leasing funnel makes; routes call these helpers rather than
// hand-rolling the steps so the same audit trail + idempotency guards apply
// from every entrypoint.
//
//   convertProspectToApplicant — BR-LA-3 one-way; locks the Prospect.
//   convertApplicantToTenant   — [G-B-4] preconditions; creates Tenant and
//                                auto-checks Stage 3 item 1 with actor System.
//   executeDraftLease          — BR-LL-11 move-in gate; snapshots DraftLease
//                                into Lease; writes the JE; auto-checks
//                                Stage 3 items 1–2; promotes Applicants→Tenants.
//
// Every helper:
//   - Is idempotent (re-running on an already-promoted record is a no-op).
//   - Writes ActivityLogEntry on each entity involved.
//   - Throws PromotionError with a `status` field for the route handler.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Prospect } from '@/lib/db/models/pm/Prospect';
import {
  Applicant,
  buildDefaultApplicantChecklist,
  APPLICANT_DEFAULT_CHECKLIST,
} from '@/lib/db/models/pm/Applicant';
import { DraftLease } from '@/lib/db/models/pm/DraftLease';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import { Property } from '@/lib/db/models/pm/Property';
import { Unit } from '@/lib/db/models/pm/Unit';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { logActivity } from '@/lib/pm/activity';
import { assertWriteAllowed } from '@/lib/pm/lockedPeriod';
import { canOverrideLockedPeriod } from '@/lib/pm/roles';
import { computeLeaseStatus } from '@/lib/pm/leaseStatus';
import { rentCentsFromRateCents } from '@/lib/pm/rent';
import {
  deriveCurrentRentFromSchedule,
  type RentSchedulePeriodModel,
} from '@/lib/validation/pm/rentSchedule';
import type { PmContext } from '@/lib/auth/getCurrentUser';

export class PromotionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PromotionError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// 1) Prospect → Applicant — BR-LA-3 one-way conversion.
// ---------------------------------------------------------------------------

export interface ConvertProspectResult {
  applicantId: string;
  alreadyConverted: boolean;
}

export async function convertProspectToApplicant(
  prospectId: string,
  ctx: PmContext,
): Promise<ConvertProspectResult> {
  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const prospect = await Prospect.findOne({
    _id: new Types.ObjectId(prospectId),
    organizationId: orgId,
  });
  if (!prospect) throw new PromotionError('Prospect not found', 404);

  if (prospect.status === 'Converted' && prospect.convertedToApplicantId) {
    return {
      applicantId: String(prospect.convertedToApplicantId),
      alreadyConverted: true,
    };
  }

  // Monotonic applicationNumber per org.
  const last = await Applicant.findOne({ organizationId: orgId })
    .sort({ applicationNumber: -1 })
    .select({ applicationNumber: 1 })
    .lean<{ applicationNumber: number } | null>();
  const applicationNumber = (last?.applicationNumber ?? 0) + 1;

  const phones =
    prospect.phone && prospect.phone.length > 0
      ? [{ number: prospect.phone, label: 'mobile' }]
      : [];

  const applicant = await Applicant.create({
    organizationId: orgId,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    applicationNumber,
    applicationReceivedAt: new Date(),
    status: 'New',
    email: prospect.email,
    phones,
    propertyId: prospect.propertyId ?? null,
    applicantAddress: {},
    rentalHistory: [],
    employment: [],
    checklist: buildDefaultApplicantChecklist(),
    screeningStatus: 'Not ordered',
    emailLinkToOnlineApplication: false,
    sourceProspectId: prospect._id,
    customFields: new Map(),
  });

  prospect.status = 'Converted';
  prospect.convertedToApplicantId = applicant._id;
  prospect.convertedAt = new Date();
  await prospect.save();

  await Promise.all([
    logActivity({
      orgId: ctx.orgId,
      parentType: 'Prospect',
      parentId: prospect._id,
      eventType: 'Prospect converted to applicant',
      actorUserId: ctx.userId,
      payload: { applicantId: String(applicant._id), applicationNumber },
    }),
    logActivity({
      orgId: ctx.orgId,
      parentType: 'Applicant',
      parentId: applicant._id,
      eventType: 'Applicant created (from Prospect)',
      actorUserId: ctx.userId,
      payload: { prospectId: String(prospect._id) },
    }),
  ]);

  return { applicantId: String(applicant._id), alreadyConverted: false };
}

// ---------------------------------------------------------------------------
// 2) Applicant → Tenant — [G-B-4] preconditions gate.
// ---------------------------------------------------------------------------

export interface ConvertApplicantInput {
  /** Optional Active lease id to attach the new tenant to. Used by the
   *  executeDraftLease flow after the lease has been created. */
  leaseId?: string | null;
  /** When true, used by executeDraftLease to skip system-generated audit
   *  noise (the parent flow logs its own promotion event). */
  silent?: boolean;
}

export interface ConvertApplicantResult {
  tenantId: string;
  alreadyPromoted: boolean;
}

export async function convertApplicantToTenant(
  applicantId: string,
  ctx: PmContext,
  input: ConvertApplicantInput = {},
): Promise<ConvertApplicantResult> {
  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const applicant = await Applicant.findOne({
    _id: new Types.ObjectId(applicantId),
    organizationId: orgId,
  });
  if (!applicant) throw new PromotionError('Applicant not found', 404);

  if (applicant.promotedToTenantId) {
    return {
      tenantId: String(applicant.promotedToTenantId),
      alreadyPromoted: true,
    };
  }

  // [G-B-4] preconditions.
  if (applicant.status !== 'Approved') {
    throw new PromotionError(
      'Applicant must be Approved before promoting to a tenant ([G-B-4]).',
    );
  }
  if (!applicant.email) {
    throw new PromotionError('Applicant email is required ([G-B-4]).');
  }
  if (!applicant.propertyId || !applicant.unitId) {
    throw new PromotionError(
      'Applicant must have a propertyId and unitId before promoting ([G-B-4]).',
    );
  }
  const stage1Items = applicant.checklist.filter((i) => i.stage === 1);
  if (stage1Items.length === 0 || stage1Items.some((i) => !i.checked)) {
    throw new PromotionError(
      'All Stage 1 checklist items must be checked before promoting ([G-B-4]).',
    );
  }

  const primaryPhone =
    applicant.phones[0]?.number && applicant.phones[0].number.length > 0
      ? { mobile: { number: applicant.phones[0].number, smsOptIn: false } }
      : {};

  const tenant = await Tenant.create({
    organizationId: orgId,
    firstName: applicant.firstName,
    lastName: applicant.lastName,
    email: applicant.email,
    phones: primaryPhone,
    address: applicant.applicantAddress ?? {},
    dateOfBirth: applicant.applicantBirthDate ?? null,
    ssnLast4: applicant.applicantSsnLast4,
    cosignerFlag: false,
    residentCenterAccess: false,
    currentLeaseId: input.leaseId ? new Types.ObjectId(input.leaseId) : null,
    customFields: new Map(),
    active: true,
  });

  applicant.promotedToTenantId = tenant._id;
  applicant.promotedAt = new Date();
  applicant.status = 'Converted';

  // Auto-check Stage 3 item 1 ("Send draft lease for signature") with actor
  // = System per BR-LA-7's spirit (the system did the move).
  const stage3Item1 = applicant.checklist.find(
    (i) =>
      i.stage === 3 &&
      i.label === APPLICANT_DEFAULT_CHECKLIST.find(
        (d) => d.stage === 3,
      )?.label,
  );
  if (stage3Item1 && !stage3Item1.checked) {
    stage3Item1.checked = true;
    stage3Item1.checkedAt = new Date();
    stage3Item1.systemChecked = true;
    stage3Item1.checkedByUserId = null;
  }
  await applicant.save();

  if (!input.silent) {
    await Promise.all([
      logActivity({
        orgId: ctx.orgId,
        parentType: 'Applicant',
        parentId: applicant._id,
        eventType: 'Applicant promoted to tenant',
        actorUserId: ctx.userId,
        payload: { tenantId: String(tenant._id) },
      }),
      logActivity({
        orgId: ctx.orgId,
        parentType: 'Tenant',
        parentId: tenant._id,
        eventType: 'Tenant created (from Applicant)',
        actorUserId: ctx.userId,
        payload: {
          applicantId: String(applicant._id),
          applicationNumber: applicant.applicationNumber,
        },
      }),
    ]);
  }

  return { tenantId: String(tenant._id), alreadyPromoted: false };
}

// ---------------------------------------------------------------------------
// 3) DraftLease → Lease — BR-LL-11 move-in gate + JE post.
// ---------------------------------------------------------------------------

export interface ExecuteDraftLeaseInput {
  postingDate?: string;
  overrideLockedPeriod?: boolean;
}

export interface ExecuteDraftLeaseResult {
  leaseId: string;
  leaseNumber: number;
  journalEntryId: string | null;
  alreadyExecuted: boolean;
}

async function lookupChartByDefaultFor(
  orgId: Types.ObjectId,
  defaultFor: string,
): Promise<Types.ObjectId | null> {
  const doc = await ChartOfAccount.findOne({
    organizationId: orgId,
    defaultFor,
    active: true,
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>();
  return doc?._id ?? null;
}

export async function executeDraftLease(
  draftLeaseId: string,
  ctx: PmContext,
  input: ExecuteDraftLeaseInput = {},
): Promise<ExecuteDraftLeaseResult> {
  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const draft = await DraftLease.findOne({
    _id: new Types.ObjectId(draftLeaseId),
    organizationId: orgId,
  });
  if (!draft) throw new PromotionError('Draft lease not found', 404);

  if (draft.executionStatus === 'Executed' && draft.promotedToLeaseId) {
    return {
      leaseId: String(draft.promotedToLeaseId),
      leaseNumber: 0,
      journalEntryId: null,
      alreadyExecuted: true,
    };
  }
  if (draft.executionStatus === 'Cancelled') {
    throw new PromotionError(
      'Cancelled drafts must be reverted to Draft before execution.',
    );
  }

  // BR-LL-11 — every move-in charge must be paid before execution.
  const unpaidMoveIn = (draft.moveInCharges ?? []).filter(
    (c) => !c.paidAt,
  );
  if (unpaidMoveIn.length > 0) {
    throw new PromotionError(
      `All move-in charges must be paid before executing the lease (${unpaidMoveIn.length} unpaid).`,
    );
  }

  // Posting date defaults to today, but accepts an override (route gates
  // overrideLockedPeriod by role).
  const txnDate = input.postingDate
    ? new Date(input.postingDate)
    : new Date();
  if (Number.isNaN(txnDate.getTime())) {
    throw new PromotionError('Invalid postingDate', 400);
  }

  // Locked-period gate (skippable only by FinancialAdministrator/Admin).
  if (!(input.overrideLockedPeriod && canOverrideLockedPeriod(ctx))) {
    await assertWriteAllowed({
      orgId: ctx.orgId,
      txnDate,
      scopePropertyId: String(draft.propertyId),
      ctx,
    });
  }

  // Resolve the Property → Operating bank → CoA mapping.
  const property = await Property.findOne({
    _id: draft.propertyId,
    organizationId: orgId,
  })
    .select({
      operatingAccountId: 1,
      depositTrustAccountId: 1,
      propertyName: 1,
    })
    .lean<{
      _id: Types.ObjectId;
      operatingAccountId: Types.ObjectId;
      depositTrustAccountId?: Types.ObjectId | null;
      propertyName: string;
    } | null>();
  if (!property) throw new PromotionError('Property not found', 404);

  const operatingBank = await BankAccount.findOne({
    _id: property.operatingAccountId,
    organizationId: orgId,
  })
    .select({ chartOfAccountId: 1 })
    .lean<{ chartOfAccountId?: Types.ObjectId | null } | null>();
  const operatingCashCoaId =
    operatingBank?.chartOfAccountId ??
    (await lookupChartByDefaultFor(orgId, 'Operating Cash'));
  const securityDepositCoaId = await lookupChartByDefaultFor(
    orgId,
    'Security Deposit Liability',
  );

  // Build the Lease snapshot from the Draft. Convert embedded ObjectIds via
  // toObject() so the new doc inserts cleanly.
  const draftObj = draft.toObject();

  // §3 — for a per-sqft lease, recompute the resolved monthly rent against the
  // unit's CURRENT sizeSqft (it may have changed since the draft was drafted).
  // The resolved amount feeds both the lease snapshot and the move-in JE below.
  let resolvedPrimaryRent = draftObj.primaryRent;
  if (draftObj.primaryRent?.rentMethod === 'RatePerSqft') {
    const unit = await Unit.findOne({
      _id: draftObj.unitId,
      organizationId: orgId,
    })
      .select({ sizeSqft: 1 })
      .lean<{ sizeSqft?: number } | null>();
    const sizeSqft = unit?.sizeSqft ?? 0;
    if (!(sizeSqft > 0)) {
      throw new PromotionError(
        "This unit has no square footage set, so rent per square foot can't be computed. Set the unit size or switch the lease to a fixed rent before executing.",
        400,
      );
    }
    resolvedPrimaryRent = {
      ...draftObj.primaryRent,
      amount: rentCentsFromRateCents(
        draftObj.primaryRent.ratePerSqftCents ?? 0,
        sizeSqft,
      ),
    };
  }

  // Commercial rent-escalation schedule (the "Lease Summary"). When the draft
  // carries one, it copies verbatim onto the lease and DRIVES GL posting; the
  // resolved CURRENT period also overrides primaryRent/splits so the move-in JE
  // and every legacy reader use the right current rent.
  const scheduleModel = draftObj.rentSchedule ?? [];
  const derivedRent =
    scheduleModel.length > 0
      ? deriveCurrentRentFromSchedule(
          scheduleModel as unknown as RentSchedulePeriodModel[],
          txnDate,
        )
      : null;
  let leasePrimaryRent = resolvedPrimaryRent;
  let leaseSplitCharges = draftObj.splitRentCharges ?? [];
  if (derivedRent) {
    leasePrimaryRent = {
      ...resolvedPrimaryRent,
      amount: derivedRent.amount,
      accountId: derivedRent.accountId,
      rentMethod: 'Fixed',
      ratePerSqftCents: 0,
      memo: derivedRent.memo,
    };
    leaseSplitCharges = derivedRent.splitRentCharges;
  }

  const last = await Lease.findOne({ organizationId: orgId })
    .sort({ leaseNumber: -1 })
    .select({ leaseNumber: 1 })
    .lean<{ leaseNumber: number } | null>();
  const leaseNumber = (last?.leaseNumber ?? 0) + 1;

  const lease = await Lease.create({
    organizationId: orgId,
    leaseNumber,
    propertyId: draftObj.propertyId,
    unitId: draftObj.unitId,
    rentalOwnerId: null,
    tenants: (draftObj.tenants ?? [])
      .filter((t) => t.tenantId)
      .map((t) => ({
        tenantId: t.tenantId as Types.ObjectId,
        tenantType: t.tenantType ?? 'Individual',
        firstName: t.firstName,
        lastName: t.lastName,
        companyName: t.companyName,
        email: t.email,
        isCosigner: false,
      })),
    cosigners: (draftObj.cosigners ?? [])
      .filter((t) => t.tenantId)
      .map((t) => ({
        tenantId: t.tenantId as Types.ObjectId,
        tenantType: t.tenantType ?? 'Individual',
        firstName: t.firstName,
        lastName: t.lastName,
        companyName: t.companyName,
        email: t.email,
        isCosigner: true,
      })),
    leaseType: draftObj.leaseType,
    startDate: draftObj.startDate ?? new Date(),
    endDate: draftObj.endDate ?? null,
    status: computeLeaseStatus({
      startDate: draftObj.startDate,
      endDate: draftObj.endDate,
      leaseType: draftObj.leaseType,
    }),
    evictionPending: false,
    rentCycle: draftObj.rentCycle,
    primaryRent: leasePrimaryRent,
    splitRentCharges: leaseSplitCharges,
    rentSchedule: scheduleModel,
    proportionateSharePct: draftObj.proportionateSharePct,
    salesTaxRatePct: draftObj.salesTaxRatePct,
    securityDeposit: {
      received: draftObj.securityDeposit ?? 0,
      withheld: 0,
      refunded: 0,
    },
    recurringCharges: draftObj.recurringCharges ?? [],
    oneTimeCharges: (draftObj.oneTimeCharges ?? []).map((c) => ({
      amount: c.amount,
      accountId: c.accountId,
      dueDate: c.dueDate ?? null,
      memo: c.memo,
      posted: false,
      postedAt: null,
    })),
    lateFeePolicy: draftObj.lateFeePolicy ?? { enabled: false },
    residentCenterWelcomeEmail: draftObj.residentCenterWelcomeEmail ?? false,
    esignatureDocuments: draftObj.esignatureDocuments ?? [],
    comments: draftObj.comments,
    files: draftObj.files ?? [],
    promotedFromDraftLeaseId: draft._id,
    customFields: new Map(),
  });

  // ----- Journal entry: first month's rent (received) + security deposit
  // received. Skipped if we cannot resolve both legs cleanly — the lease
  // still saves, but the route surfaces the warning so a PM can post a
  // manual JE.
  let journalEntryId: Types.ObjectId | null = null;
  // Use the schedule-derived current rent (when a schedule exists) so the
  // first-month JE matches the lease's first active period.
  const rentCents = leasePrimaryRent?.amount ?? 0;
  const rentAccountId = leasePrimaryRent?.accountId ?? draft.primaryRent.accountId;
  // §4 — first month's rent also includes the OPEX/Tax recovery splits, each
  // credited to its own income account so the recoveries report separately.
  const splitCharges = (leaseSplitCharges ?? []).filter(
    (c) => (c.amount ?? 0) > 0 && c.accountId,
  );
  const splitCents = splitCharges.reduce((s, c) => s + (c.amount ?? 0), 0);
  const depositCents = draft.securityDeposit ?? 0;
  const totalIn = rentCents + splitCents + depositCents;

  if (operatingCashCoaId && totalIn > 0) {
    const lines: Array<Record<string, unknown>> = [];
    lines.push({
      accountId: operatingCashCoaId,
      scopeType: 'Property',
      scopeId: lease.propertyId,
      unitId: lease.unitId,
      description: `Move-in funds received (lease #${leaseNumber})`,
      debit: totalIn,
      credit: 0,
    });
    if (rentCents > 0) {
      lines.push({
        accountId: rentAccountId,
        scopeType: 'Property',
        scopeId: lease.propertyId,
        unitId: lease.unitId,
        description: 'First month rent income',
        debit: 0,
        credit: rentCents,
      });
    }
    for (const c of splitCharges) {
      lines.push({
        accountId: c.accountId,
        scopeType: 'Property',
        scopeId: lease.propertyId,
        unitId: lease.unitId,
        description: c.memo || 'First month recovery income',
        debit: 0,
        credit: c.amount,
      });
    }
    if (depositCents > 0 && securityDepositCoaId) {
      lines.push({
        accountId: securityDepositCoaId,
        scopeType: 'Property',
        scopeId: lease.propertyId,
        unitId: lease.unitId,
        description: 'Security deposit received',
        debit: 0,
        credit: depositCents,
      });
    }

    const totalDebit = lines.reduce(
      (s, l) => s + (Number(l.debit) || 0),
      0,
    );
    const totalCredit = lines.reduce(
      (s, l) => s + (Number(l.credit) || 0),
      0,
    );
    if (totalDebit === totalCredit && totalDebit > 0) {
      const je = await JournalEntry.create({
        organizationId: orgId,
        date: txnDate,
        scopeType: 'Property',
        scopeId: lease.propertyId,
        memo: `Move-in JE for lease #${leaseNumber} at ${property.propertyName}`,
        lines,
        status: 'Posted',
        postedAt: txnDate,
        createdByUserId: new Types.ObjectId(ctx.userId),
      });
      journalEntryId = je._id;
    }
  }

  // Promote each approved Applicant → Tenant if not already, attach
  // currentLeaseId to existing Tenants.
  const tenantIds: Types.ObjectId[] = [];
  for (const approved of draft.approvedApplicants ?? []) {
    const promo = await convertApplicantToTenant(
      String(approved.applicantId),
      ctx,
      { leaseId: String(lease._id), silent: true },
    ).catch((err: unknown) => {
      // Don't break the execute on a single applicant precondition fail —
      // log and continue so the lease still exists.
      const msg = err instanceof Error ? err.message : 'unknown';
      console.warn('executeDraftLease: applicant promotion failed', msg);
      return null;
    });
    if (promo?.tenantId) {
      tenantIds.push(new Types.ObjectId(promo.tenantId));
    }
  }

  // Backfill Lease.tenants with the new Tenant ids when the draft was built
  // before applicants were promoted.
  if (tenantIds.length > 0 && lease.tenants.length === 0) {
    const tenants = await Tenant.find({
      organizationId: orgId,
      _id: { $in: tenantIds },
    })
      .select({ firstName: 1, lastName: 1, email: 1, tenantType: 1, companyName: 1 })
      .lean();
    lease.tenants = tenants.map((t) => ({
      tenantId: t._id as Types.ObjectId,
      tenantType: t.tenantType ?? 'Individual',
      firstName: t.firstName,
      lastName: t.lastName,
      companyName: t.companyName ?? undefined,
      email: t.email ?? undefined,
      isCosigner: false,
    }));
    await lease.save();
  }

  // Sync Tenant.currentLeaseId for every tenant on the lease.
  const allTenantIds = lease.tenants
    .map((t) => t.tenantId)
    .filter((v): v is Types.ObjectId => Boolean(v));
  if (allTenantIds.length > 0) {
    await Tenant.updateMany(
      { organizationId: orgId, _id: { $in: allTenantIds } },
      { $set: { currentLeaseId: lease._id } },
    );
  }

  // Stage 3 items 1+2 auto-checked on each Applicant
  await Applicant.updateMany(
    {
      organizationId: orgId,
      _id: {
        $in: (draft.approvedApplicants ?? []).map((a) => a.applicantId),
      },
    },
    {
      $set: {
        'checklist.$[s31].checked': true,
        'checklist.$[s31].checkedAt': new Date(),
        'checklist.$[s31].systemChecked': true,
        'checklist.$[s31].checkedByUserId': null,
        'checklist.$[s32].checked': true,
        'checklist.$[s32].checkedAt': new Date(),
        'checklist.$[s32].systemChecked': true,
        'checklist.$[s32].checkedByUserId': null,
      },
    },
    {
      arrayFilters: [
        {
          's31.stage': 3,
          's31.label': APPLICANT_DEFAULT_CHECKLIST.filter(
            (i) => i.stage === 3,
          )[0]?.label ?? 'Send draft lease for signature',
        },
        {
          's32.stage': 3,
          's32.label': APPLICANT_DEFAULT_CHECKLIST.filter(
            (i) => i.stage === 3,
          )[1]?.label ?? 'Collect security deposit + first month rent',
        },
      ],
    },
  );

  draft.executionStatus = 'Executed';
  draft.promotedToLeaseId = lease._id;
  draft.promotedAt = new Date();
  await draft.save();

  await Promise.all([
    logActivity({
      orgId: ctx.orgId,
      parentType: 'DraftLease',
      parentId: draft._id,
      eventType: 'Draft lease executed',
      actorUserId: ctx.userId,
      payload: {
        leaseId: String(lease._id),
        leaseNumber,
        journalEntryId: journalEntryId ? String(journalEntryId) : null,
      },
    }),
    logActivity({
      orgId: ctx.orgId,
      parentType: 'Lease',
      parentId: lease._id,
      eventType: 'Lease created (from DraftLease)',
      actorUserId: ctx.userId,
      payload: {
        leaseNumber,
        draftLeaseId: String(draft._id),
      },
    }),
  ]);

  return {
    leaseId: String(lease._id),
    leaseNumber,
    journalEntryId: journalEntryId ? String(journalEntryId) : null,
    alreadyExecuted: false,
  };
}

