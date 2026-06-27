// Cron entry point — Vercel Cron (or any external scheduler) hits this
// endpoint nightly and the worker scans Active/Future leases, auto-posting any
// due recurring rent charge (the automated counterpart of the manual "Post
// recurring due now" button). Multi-tenancy is enforced by running the worker
// once PER ORG: the cron fans out over the distinct orgs that own leases with
// recurring charges so a sweep can never cross tenant boundaries.
//
// Auth model mirrors /api/cron/post-recurring: the call carries an
// Authorization header whose secret is checked against `process.env.CRON_SECRET`.
// In dev the call falls through without the header so manual `curl` works.
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { runLeaseRecurringPoster } from '@/lib/pm/leaseRecurringPoster';

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
  // Run per-org so the worker's queries are tenant-scoped. Every org that owns
  // at least one Active/Future lease with a posting schedule is processed.
  // The schedule lives in EITHER a `recurringCharges[]` row OR the base-rent
  // cursor `primaryRent.nextDueDate`; this $or must mirror the worker's own
  // candidate query (runLeaseRecurringPoster). The old filter required a
  // recurringCharges row, so an org whose rent lived only in primaryRent was
  // never swept and its `nextDueDate` cursor never advanced.
  const orgIds = (await Lease.distinct('organizationId', {
    status: { $in: ['Active', 'Future'] },
    $or: [
      { 'recurringCharges.0': { $exists: true } },
      { 'primaryRent.nextDueDate': { $ne: null } },
    ],
  })) as unknown[];

  const results = [];
  for (const orgId of orgIds) {
    const orgResults = await runLeaseRecurringPoster(String(orgId));
    results.push(...orgResults);
  }

  const posted = results.filter((r) => r.posted).length;
  return NextResponse.json({
    ran: results.length,
    posted,
    skipped: results.length - posted,
    orgsProcessed: orgIds.length,
    results,
  });
}

export const POST = GET;
