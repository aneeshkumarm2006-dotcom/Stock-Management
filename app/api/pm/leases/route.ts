// Lease CRUD (PDR §3.3). The list view defaults to BR-LL-2 filter
// `(2) Active, Future`. POST is the data-import path — most leases come into
// existence via /draft-leases/[id]/execute.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { leaseCreateSchema } from '@/lib/validation/pm/lease';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import { LEASE_STATUSES } from '@/types/pm';
import type { LeaseType, RentCycle } from '@/types/pm';
import { computeLeaseStatus, daysRemaining } from '@/lib/pm/leaseStatus';

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
        firstName: t.firstName,
        lastName: t.lastName,
      })),
      leaseType: r.leaseType,
      startDate: r.startDate,
      endDate: r.endDate ?? null,
      status: r.status,
      evictionPending: r.evictionPending,
      evictionPendingNote: r.evictionPendingNote ?? '',
      rentCycle: r.rentCycle,
      primaryRentAmount: r.primaryRent?.amount ?? 0,
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
  const last = await Lease.findOne({ organizationId: orgId })
    .sort({ leaseNumber: -1 })
    .select({ leaseNumber: 1 })
    .lean<{ leaseNumber: number } | null>();
  const leaseNumber = (last?.leaseNumber ?? 0) + 1;

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
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email,
        isCosigner: t.isCosigner ?? false,
      })),
      cosigners: (parsed.data.cosigners ?? []).map((t) => ({
        tenantId: new Types.ObjectId(t.tenantId),
        firstName: t.firstName,
        lastName: t.lastName,
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
        amount: toCents(parsed.data.primaryRent.amount),
        accountId: new Types.ObjectId(parsed.data.primaryRent.accountId),
        nextDueDate: parsed.data.primaryRent.nextDueDate
          ? new Date(parsed.data.primaryRent.nextDueDate)
          : null,
        memo: parsed.data.primaryRent.memo,
      },
      splitRentCharges: (parsed.data.splitRentCharges ?? []).map((c) => ({
        accountId: new Types.ObjectId(c.accountId),
        amount: toCents(c.amount),
        memo: c.memo,
      })),
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
