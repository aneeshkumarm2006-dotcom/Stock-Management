// POST /api/pm/leases/:id/renewal
//
// Seeds a renewal projection — clones the existing lease's terms into a new
// DraftLease starting one day after the current endDate, with
// `leaseType='Fixed w/rollover'` per BR-LL-10. [G-B-8] preconditions: source
// lease must be Active or Expired AND (At-will OR endDate ≤ today + 90 days).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { DraftLease } from '@/lib/db/models/pm/DraftLease';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const source = await Lease.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgId,
  });
  if (!source) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // [G-B-8] preconditions.
  if (!['Active', 'Expired'].includes(source.status)) {
    return NextResponse.json(
      {
        error:
          'Renewal requires the source lease to be Active or Expired ([G-B-8]).',
      },
      { status: 409 },
    );
  }
  if (source.leaseType !== 'At-will') {
    if (!source.endDate) {
      return NextResponse.json(
        { error: 'Fixed lease missing endDate; cannot renew.' },
        { status: 409 },
      );
    }
    const ninetyOut = new Date(Date.now() + 90 * DAY_MS);
    if (source.endDate > ninetyOut) {
      return NextResponse.json(
        {
          error:
            'Renewal only available within 90 days of endDate ([G-B-8]).',
        },
        { status: 409 },
      );
    }
  }

  const last = await DraftLease.findOne({ organizationId: orgId })
    .sort({ draftId: -1 })
    .select({ draftId: 1 })
    .lean<{ draftId: number } | null>();
  const draftId = (last?.draftId ?? 0) + 1;

  const startDate = source.endDate
    ? new Date(source.endDate.getTime() + DAY_MS)
    : new Date();
  // Default to 12-month rollover.
  const endDate = new Date(startDate.getTime() + 365 * DAY_MS);

  const draft = await DraftLease.create({
    organizationId: orgId,
    draftId,
    signatureStatus: 'Unknown',
    esignatureStatus: 'Not sent',
    executionStatus: 'Draft',
    propertyId: source.propertyId,
    unitId: source.unitId,
    leaseType: 'Fixed w/rollover',
    startDate,
    endDate,
    leasingAgentUserId: null,
    approvedApplicants: [],
    tenants: source.tenants.map((t) => ({
      tenantId: t.tenantId,
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      isCosigner: false,
    })),
    cosigners: source.cosigners.map((t) => ({
      tenantId: t.tenantId,
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      isCosigner: true,
    })),
    rentCycle: source.rentCycle,
    primaryRent: {
      amount: source.primaryRent.amount,
      accountId: source.primaryRent.accountId,
      nextDueDate: startDate,
      memo: source.primaryRent.memo,
    },
    splitRentCharges: source.splitRentCharges ?? [],
    securityDeposit: source.securityDeposit?.received ?? 0,
    recurringCharges: source.recurringCharges ?? [],
    oneTimeCharges: [],
    moveInCharges: [],
    lateFeePolicy: source.lateFeePolicy ?? { enabled: false },
    residentCenterWelcomeEmail: false,
    esignatureDocuments: [],
    comments: source.comments,
    files: [],
    customFields: new Map(),
  });

  await Promise.all([
    logActivity({
      orgId: ctx.orgId,
      parentType: 'Lease',
      parentId: source._id,
      eventType: 'Lease renewal seeded',
      actorUserId: ctx.userId,
      payload: { draftLeaseId: String(draft._id), draftId },
    }),
    logActivity({
      orgId: ctx.orgId,
      parentType: 'DraftLease',
      parentId: draft._id,
      eventType: 'Draft lease seeded from renewal',
      actorUserId: ctx.userId,
      payload: { sourceLeaseId: String(source._id) },
    }),
  ]);

  return NextResponse.json(
    {
      ok: true,
      draftLeaseId: String(draft._id),
      draftId,
      startDate,
      endDate,
    },
    { status: 201 },
  );
}
