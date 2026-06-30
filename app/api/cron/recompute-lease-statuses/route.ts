// Cron entry point — Vercel Cron (or any external scheduler) hits this
// endpoint nightly and reconciles each org's persisted lease `status` and
// `Tenant.currentLeaseId` with the time-driven truth (deriveLeaseStatus).
//
// Why this exists: lease status is persisted for fast filtering but the real
// status is date-driven, so a lease that passes its endDate becomes Expired by
// the mere passage of time. Nothing refreshes the persisted value on its own —
// `recomputeLeaseStatuses` only runs on a lease write. Left unreconciled, the
// stale `Active` status / dangling `currentLeaseId` make the assignment guards
// in /api/pm/leases falsely reject a unit or tenant whose lease has actually
// expired ("Unit already has an active or future lease" / "already assigned").
// This sweep is the durable fix the codebase always anticipated
// (leaseStatus.ts: "TODO Phase 6 — wire to a nightly cron").
//
// Multi-tenancy: run once PER ORG so every query is tenant-scoped and a sweep
// can never cross tenant boundaries. Auth mirrors the other cron routes — a
// Bearer secret checked against process.env.CRON_SECRET; in dev the call falls
// through without the header so a manual `curl` works.
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { recomputeLeaseStatuses } from '@/lib/pm/leaseStatus';

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production'; // fail-closed in prod
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await connectToDatabase();
  // Every org that owns at least one non-terminal lease — i.e. one whose
  // persisted status could still drift. Mirrors the candidate set
  // recomputeLeaseStatuses itself scans (Active/Future/Expired).
  const orgIds = (await Lease.distinct('organizationId', {
    status: { $in: ['Active', 'Future', 'Expired'] },
  })) as unknown[];

  const results = [];
  for (const orgId of orgIds) {
    const res = await recomputeLeaseStatuses(String(orgId));
    results.push({ orgId: String(orgId), ...res });
  }

  return NextResponse.json({
    orgsProcessed: orgIds.length,
    leasesUpdated: results.reduce((s, r) => s + r.updated, 0),
    tenantsTouched: results.reduce((s, r) => s + r.tenantsTouched, 0),
    results,
  });
}

export const POST = GET;
