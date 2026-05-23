// Rentals Summary — Dashboard widgets (PROPERTY_TODO.md Phase 10).
// Powers the Rental Listings 2x2 donut (occupied × listed) and the Expiring
// Leases pipeline-stage chart. Both need org-wide counts that no other
// endpoint already exposes:
//   - /api/pm/units requires a propertyId
//   - /api/pm/listings only sees units that have an explicit Listing row
//
// Returns one JSON payload so the dashboard fires a single request:
//   units: {
//     total,
//     vacantUnlisted,
//     vacantListed,
//     occupiedUnlisted,
//     occupiedListed,
//   }
//   leaseStages: {
//     notStarted,  // Future leases starting in <=90 days, no draft renewal
//     offers,      // Draft leases in flight
//     renewals,    // Leases ending in <=90 days with a renewal draft attached
//     moveOuts,    // Leases ending in <=90 days flagged eviction or not renewing
//   }
//   expiringByWindow: { d0_30, d31_60, d61_90, all }
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Unit } from '@/lib/db/models/pm/Unit';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Listing } from '@/lib/db/models/pm/Listing';
import { DraftLease } from '@/lib/db/models/pm/DraftLease';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { daysRemaining } from '@/lib/pm/leaseStatus';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);

  const [units, leases, listings, drafts] = await Promise.all([
    Unit.find({ organizationId: orgId }).select({ _id: 1 }).lean(),
    Lease.find({
      organizationId: orgId,
      status: { $in: ['Active', 'Future'] },
    })
      .select({
        _id: 1,
        unitId: 1,
        status: 1,
        startDate: 1,
        endDate: 1,
        leaseType: 1,
        evictionPending: 1,
      })
      .lean(),
    Listing.find({ organizationId: orgId })
      .select({ _id: 1, unitId: 1, listed: 1 })
      .lean(),
    DraftLease.find({ organizationId: orgId })
      .select({ _id: 1, unitId: 1, status: 1 })
      .lean()
      .catch(() => []),
  ]);

  const total = units.length;
  const occupiedSet = new Set<string>();
  for (const l of leases) {
    if (l.status === 'Active') occupiedSet.add(String(l.unitId));
  }
  const listedSet = new Set<string>();
  for (const lst of listings) {
    if (lst.listed) listedSet.add(String(lst.unitId));
  }

  let vacantUnlisted = 0;
  let vacantListed = 0;
  let occupiedUnlisted = 0;
  let occupiedListed = 0;
  for (const u of units) {
    const key = String(u._id);
    const occupied = occupiedSet.has(key);
    const listed = listedSet.has(key);
    if (occupied && listed) occupiedListed += 1;
    else if (occupied && !listed) occupiedUnlisted += 1;
    else if (!occupied && listed) vacantListed += 1;
    else vacantUnlisted += 1;
  }

  // Lease pipeline stages — counted against Active leases expiring soon.
  const draftUnitIds = new Set<string>();
  let openDrafts = 0;
  for (const d of drafts) {
    const status = String((d as { status?: string }).status ?? '');
    if (status === 'Cancelled' || status === 'Executed') continue;
    openDrafts += 1;
    draftUnitIds.add(String((d as { unitId?: unknown }).unitId ?? ''));
  }

  let notStarted = 0;
  let renewals = 0;
  let moveOuts = 0;
  let d0_30 = 0;
  let d31_60 = 0;
  let d61_90 = 0;

  for (const l of leases) {
    const dr = daysRemaining({
      endDate: (l.endDate as Date | null) ?? null,
      leaseType: l.leaseType,
    });
    if (dr == null || dr > 90 || dr < 0) continue;
    if (dr <= 30) d0_30 += 1;
    else if (dr <= 60) d31_60 += 1;
    else d61_90 += 1;
    const hasDraft = draftUnitIds.has(String(l.unitId));
    if (l.evictionPending) moveOuts += 1;
    else if (hasDraft) renewals += 1;
    else notStarted += 1;
  }

  return NextResponse.json({
    units: {
      total,
      vacantUnlisted,
      vacantListed,
      occupiedUnlisted,
      occupiedListed,
    },
    leaseStages: {
      notStarted,
      offers: openDrafts,
      renewals,
      moveOuts,
    },
    expiringByWindow: {
      d0_30,
      d31_60,
      d61_90,
      all: d0_30 + d31_60 + d61_90,
    },
  });
}
