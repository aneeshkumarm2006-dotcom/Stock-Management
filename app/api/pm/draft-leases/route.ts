// DraftLease CRUD (PDR §3.4). POST assigns a monotonic draftId per org.
// Inline file cap (BR-PU-7) and memo cap (BR-PU-6) are enforced upstream by
// the Zod validator and the model save hook.
//
// BR-LL-9 — creating a draft on an occupied unit succeeds but the GET-one
// route surfaces a `conflict` payload so the UI can render the
// "Update existing lease" banner.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { DraftLease } from '@/lib/db/models/pm/DraftLease';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { draftLeaseCreateSchema } from '@/lib/validation/pm/draftLease';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import { computeWarnings } from '@/lib/pm/warnings';
import { DRAFT_LEASE_EXECUTION_STATUSES } from '@/types/pm';

export const runtime = 'nodejs';

function toCharge(input: {
  amount?: number;
  accountId?: string;
  dueDate?: string | null;
  memo?: string;
  isMoveInCharge?: boolean;
}) {
  return {
    amount: toCents(input.amount ?? 0),
    accountId: input.accountId ? new Types.ObjectId(input.accountId) : null,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    memo: input.memo,
    isMoveInCharge: input.isMoveInCharge ?? false,
    paidAt: null,
    paidByApplicantId: null,
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('executionStatus');

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (statusParam) {
    const list = statusParam
      .split(',')
      .filter((v) =>
        (DRAFT_LEASE_EXECUTION_STATUSES as readonly string[]).includes(v),
      );
    if (list.length > 0) filter.executionStatus = { $in: list };
  }

  const rows = await DraftLease.find(filter)
    .sort({ updatedAt: -1 })
    .lean();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      draftId: r.draftId,
      executionStatus: r.executionStatus,
      esignatureStatus: r.esignatureStatus,
      signatureStatus: r.signatureStatus,
      propertyId: String(r.propertyId),
      unitId: String(r.unitId),
      leaseType: r.leaseType,
      startDate: r.startDate ?? null,
      endDate: r.endDate ?? null,
      primaryRentAmount: r.primaryRent?.amount ?? 0,
      securityDeposit: r.securityDeposit,
      moveInChargesUnpaid: (r.moveInCharges ?? []).filter((c) => !c.paidAt).length,
      moveInChargesTotal: (r.moveInCharges ?? []).length,
      approvedApplicantsCount: (r.approvedApplicants ?? []).length,
      promotedToLeaseId: r.promotedToLeaseId
        ? String(r.promotedToLeaseId)
        : null,
      updatedAt: r.updatedAt,
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
  const parsed = draftLeaseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const last = await DraftLease.findOne({ organizationId: orgId })
    .sort({ draftId: -1 })
    .select({ draftId: 1 })
    .lean<{ draftId: number } | null>();
  const draftId = (last?.draftId ?? 0) + 1;

  try {
    const doc = await DraftLease.create({
      organizationId: orgId,
      draftId,
      signatureStatus: 'Unknown',
      esignatureStatus: 'Not sent',
      executionStatus: 'Draft',
      propertyId: parsed.data.propertyId
        ? new Types.ObjectId(parsed.data.propertyId)
        : null,
      unitId: parsed.data.unitId
        ? new Types.ObjectId(parsed.data.unitId)
        : null,
      leaseType: parsed.data.leaseType ?? 'Fixed',
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      leasingAgentUserId: parsed.data.leasingAgentUserId
        ? new Types.ObjectId(parsed.data.leasingAgentUserId)
        : null,
      approvedApplicants: (parsed.data.approvedApplicants ?? []).map((a) => ({
        applicantId: new Types.ObjectId(a.applicantId),
        firstName: a.firstName,
        lastName: a.lastName,
      })),
      tenants: (parsed.data.tenants ?? []).map((t) => ({
        tenantId: t.tenantId ? new Types.ObjectId(t.tenantId) : null,
        firstName: t.firstName ?? '',
        lastName: t.lastName ?? '',
        email: t.email,
        isCosigner: t.isCosigner ?? false,
      })),
      cosigners: (parsed.data.cosigners ?? []).map((t) => ({
        tenantId: t.tenantId ? new Types.ObjectId(t.tenantId) : null,
        firstName: t.firstName ?? '',
        lastName: t.lastName ?? '',
        email: t.email,
        isCosigner: true,
      })),
      rentCycle: parsed.data.rentCycle ?? 'Monthly',
      primaryRent: {
        amount: toCents(parsed.data.primaryRent?.amount ?? 0),
        accountId: parsed.data.primaryRent?.accountId
          ? new Types.ObjectId(parsed.data.primaryRent.accountId)
          : null,
        nextDueDate: parsed.data.primaryRent?.nextDueDate
          ? new Date(parsed.data.primaryRent.nextDueDate)
          : null,
        memo: parsed.data.primaryRent?.memo,
      },
      splitRentCharges: (parsed.data.splitRentCharges ?? []).map((c) => ({
        accountId: c.accountId ? new Types.ObjectId(c.accountId) : null,
        amount: toCents(c.amount ?? 0),
        memo: c.memo,
      })),
      securityDeposit: toCents(parsed.data.securityDeposit ?? 0),
      recurringCharges: (parsed.data.recurringCharges ?? []).map((c) => ({
        amount: toCents(c.amount ?? 0),
        accountId: c.accountId ? new Types.ObjectId(c.accountId) : null,
        frequency: c.frequency ?? 'Monthly',
        nextDate: c.nextDate ? new Date(c.nextDate) : null,
        memo: c.memo,
        postNDaysInAdvance: c.postNDaysInAdvance ?? 5,
      })),
      oneTimeCharges: (parsed.data.oneTimeCharges ?? []).map(toCharge),
      moveInCharges: (parsed.data.moveInCharges ?? []).map((c) =>
        toCharge({ ...c, isMoveInCharge: true }),
      ),
      lateFeePolicy: parsed.data.lateFeePolicy ?? { enabled: false },
      residentCenterWelcomeEmail:
        parsed.data.residentCenterWelcomeEmail ?? false,
      esignatureDocuments: (parsed.data.esignatureDocuments ?? []).map(
        (d) => ({
          fileId: d.fileId ? new Types.ObjectId(d.fileId) : null,
          role: d.role ?? 'Lease',
          label: d.label ?? '',
          status: d.status ?? 'Not sent',
          sentAt: null,
          signedAt: null,
        }),
      ),
      comments: parsed.data.comments,
      recentNotes: parsed.data.recentNotes,
      files: (parsed.data.files ?? []).map((id) => new Types.ObjectId(id)),
      customFields: parsed.data.customFields ?? {},
    });

    const computed = computeWarnings(doc.toObject(), 'DraftLease');
    if (computed.length > 0) {
      doc.warnings = computed;
      await doc.save();
    }

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'DraftLease',
      parentId: doc._id,
      eventType: 'Draft lease created',
      actorUserId: ctx.userId,
      payload: { draftId },
    });

    return NextResponse.json(
      { id: String(doc._id), draftId, warnings: doc.warnings },
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Failed to create draft lease';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
