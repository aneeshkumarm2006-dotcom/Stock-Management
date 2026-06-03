// Cron entry point — Vercel Cron (or any external scheduler) hits this
// endpoint daily and the worker scans active RecurringTransactions
// (BR-AC-8). Multi-tenancy is enforced by running the worker once PER ORG:
// the cron fans out over the distinct orgs that own active rules so a sweep
// can never cross tenant boundaries (DEL-003).
//
// Auth model: the Vercel Cron call carries an Authorization header whose
// secret is checked against `process.env.CRON_SECRET`. In dev the call falls
// through without the header so manual `curl` works during local testing.
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RecurringTransaction } from '@/lib/db/models/pm/RecurringTransaction';
import { runRecurringPoster } from '@/lib/pm/recurringPoster';

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev fallback
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await connectToDatabase();
  // Run per-org so the worker's queries are tenant-scoped. Every org that has
  // at least one active rule is processed — existing scheduled rules keep
  // firing, just isolated to their own org.
  const orgIds = (await RecurringTransaction.distinct('organizationId', {
    active: true,
  })) as unknown[];

  const results = [];
  for (const orgId of orgIds) {
    const orgResults = await runRecurringPoster(String(orgId));
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
