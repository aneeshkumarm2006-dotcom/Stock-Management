// Cron entry point — Vercel Cron (or any external scheduler) hits this
// endpoint daily and the worker scans all active RecurringTransactions
// (BR-AC-8). The cron is org-agnostic; the worker handles multi-tenancy
// internally.
//
// Auth model: the Vercel Cron call carries an Authorization header whose
// secret is checked against `process.env.CRON_SECRET`. In dev the call falls
// through without the header so manual `curl` works during local testing.
import { NextResponse } from 'next/server';
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
  const results = await runRecurringPoster();
  const posted = results.filter((r) => r.posted).length;
  return NextResponse.json({
    ran: results.length,
    posted,
    skipped: results.length - posted,
    results,
  });
}

export const POST = GET;
