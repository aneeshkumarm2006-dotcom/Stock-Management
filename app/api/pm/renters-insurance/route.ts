// Org-wide Renters Insurance rollup — Dashboard widgets (PROPERTY_TODO.md
// Phase 10). One round-trip returns:
//   counts:   { msi, thirdParty, uninsured, total } — drives the donut
//   expiring: { expired, days0_30, days31_60, days61_90 } — drives the
//             "Expiring Renters Insurance" 4-tab card
//   expiringPolicies: latest 10 policies whose `expirationDate` is in the
//             next 90 days (or already expired), with lease label
//
// "Uninsured" = active-or-future leases with no policy whose effective window
// covers today. We don't try to count covered residents vs uninsured residents
// at the dashboard level — that lives on the Lease detail page (BR-LL-6).
//
// Per-lease nested CRUD remains at /api/pm/leases/[id]/renters-insurance —
// this route is read-only.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { RentersInsurancePolicy } from '@/lib/db/models/pm/RentersInsurancePolicy';
import { Property } from '@/lib/db/models/pm/Property';
import { Unit } from '@/lib/db/models/pm/Unit';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / DAY_MS);
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);

  // 1. Active+Future leases — denominator for the donut.
  const leases = await Lease.find({
    organizationId: orgId,
    status: { $in: ['Active', 'Future'] },
  })
    .select({ _id: 1, propertyId: 1, unitId: 1, tenants: 1 })
    .lean();
  const totalLeases = leases.length;
  const activeLeaseIds = new Set(leases.map((l) => String(l._id)));

  // 2. All policies in the org. We re-bucket in JS so the rules can stay
  //    co-located with the constants (carrier list, expiry windows).
  const policies = await RentersInsurancePolicy.find({
    organizationId: orgId,
  })
    .select({
      _id: 1,
      leaseId: 1,
      carrier: 1,
      policyNumber: 1,
      effectiveDate: 1,
      expirationDate: 1,
    })
    .sort({ expirationDate: 1 })
    .lean();

  const now = Date.now();
  let msi = 0;
  let thirdParty = 0;
  let expired = 0;
  let days0_30 = 0;
  let days31_60 = 0;
  let days61_90 = 0;

  const coveredLeases = new Set<string>();
  const expiringRaw: Array<{
    id: string;
    leaseId: string;
    carrier: string;
    policyNumber: string;
    expirationDate: Date;
    daysUntil: number;
  }> = [];

  for (const p of policies) {
    const leaseKey = String(p.leaseId);
    if (!activeLeaseIds.has(leaseKey)) continue; // policy on an ended lease

    const exp = p.expirationDate instanceof Date
      ? p.expirationDate
      : new Date(p.expirationDate as unknown as string);
    const eff = p.effectiveDate instanceof Date
      ? p.effectiveDate
      : new Date(p.effectiveDate as unknown as string);

    // A policy "covers" the lease today only if now is in [eff, exp].
    if (eff.getTime() <= now && exp.getTime() >= now) {
      coveredLeases.add(leaseKey);
      if (p.carrier === 'MSI') msi += 1;
      else thirdParty += 1;
    }

    const dUntil = daysFromNow(exp);
    if (dUntil < 0) {
      expired += 1;
    } else if (dUntil <= 30) {
      days0_30 += 1;
    } else if (dUntil <= 60) {
      days31_60 += 1;
    } else if (dUntil <= 90) {
      days61_90 += 1;
    }

    if (dUntil <= 90) {
      expiringRaw.push({
        id: String(p._id),
        leaseId: leaseKey,
        carrier: String(p.carrier ?? ''),
        policyNumber: p.policyNumber ?? '',
        expirationDate: exp,
        daysUntil: dUntil,
      });
    }
  }

  const uninsured = Math.max(0, totalLeases - coveredLeases.size);

  // 3. Label join for the top expiring policies — fetch property/unit by
  //    way of the lease records we already have in memory.
  const top = expiringRaw.slice(0, 10);
  const leaseById = new Map(leases.map((l) => [String(l._id), l]));
  const propIds = new Set<string>();
  const unitIds = new Set<string>();
  for (const r of top) {
    const l = leaseById.get(r.leaseId);
    if (l?.propertyId) propIds.add(String(l.propertyId));
    if (l?.unitId) unitIds.add(String(l.unitId));
  }
  const [props, units] = await Promise.all([
    propIds.size === 0
      ? Promise.resolve([])
      : Property.find({
          organizationId: orgId,
          _id: { $in: Array.from(propIds).map((p) => new Types.ObjectId(p)) },
        })
          .select({ _id: 1, propertyName: 1 })
          .lean(),
    unitIds.size === 0
      ? Promise.resolve([])
      : Unit.find({
          organizationId: orgId,
          _id: { $in: Array.from(unitIds).map((u) => new Types.ObjectId(u)) },
        })
          .select({ _id: 1, unitId: 1 })
          .lean(),
  ]);
  const propByKey = new Map(props.map((p) => [String(p._id), p]));
  const unitByKey = new Map(units.map((u) => [String(u._id), u]));

  const expiringPolicies = top.map((r) => {
    const lease = leaseById.get(r.leaseId);
    const prop = lease?.propertyId ? propByKey.get(String(lease.propertyId)) : null;
    const unit = lease?.unitId ? unitByKey.get(String(lease.unitId)) : null;
    const label =
      (prop?.propertyName ?? 'Unknown') +
      (unit?.unitId ? ` - ${unit.unitId}` : '');
    return {
      id: r.id,
      leaseId: r.leaseId,
      carrier: r.carrier,
      policyNumber: r.policyNumber,
      label,
      expirationDate: r.expirationDate,
      daysUntil: r.daysUntil,
    };
  });

  return NextResponse.json({
    counts: { msi, thirdParty, uninsured, total: totalLeases },
    expiring: { expired, days0_30, days31_60, days61_90 },
    expiringPolicies,
  });
}
