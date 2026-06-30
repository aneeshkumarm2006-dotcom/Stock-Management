// Session-authed "Reconcile lease statuses now" endpoint. Lets an Admin or
// PropertyManager manually reconcile persisted lease `status` +
// `Tenant.currentLeaseId` for THEIR org only (org-scoped via ctx.orgId),
// instead of waiting for the nightly cron (app/api/cron/recompute-lease-statuses).
//
// Why a manual trigger exists: lease expiry is time-driven, so rows that lapsed
// before the reconcile cron shipped still carry a stale `Active` status /
// dangling `currentLeaseId` — which makes the assignment guards in
// /api/pm/leases falsely reject an expired unit or tenant. This is the one-shot
// "fix my existing stale data right now" button; the cron keeps it fixed going
// forward.
import { NextResponse } from 'next/server';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { recomputeLeaseStatuses } from '@/lib/pm/leaseStatus';

export const runtime = 'nodejs';

export async function POST() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  // Mirrors the lease-cancel gate: this rewrites lease status + tenant pointers
  // org-wide, so keep it to the roles that already manage leases.
  const canReconcile =
    ctx.roles.includes('Admin') || ctx.roles.includes('PropertyManager');
  if (!canReconcile) {
    return NextResponse.json(
      { error: 'Only Admin or PropertyManager can reconcile lease statuses' },
      { status: 403 },
    );
  }

  try {
    const result = await recomputeLeaseStatuses(ctx.orgId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to reconcile statuses',
      },
      { status: 500 },
    );
  }
}
