// Session-authed "Run poster now" endpoint. Lets an authenticated user
// manually trigger the recurring poster for THEIR org only (org-scoped via
// ctx.orgId), instead of hitting the cron endpoint which is guarded by the
// shared CRON_SECRET and runs across all tenants. The cron entry point
// (app/api/cron/post-recurring/route.ts) remains the scheduler's target.
import { NextResponse } from 'next/server';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { runRecurringPoster } from '@/lib/pm/recurringPoster';

export const runtime = 'nodejs';

export async function POST() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  try {
    const results = await runRecurringPoster(ctx.orgId);
    const posted = results.filter((r) => r.posted).length;
    return NextResponse.json({
      ran: results.length,
      posted,
      skipped: results.length - posted,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to run poster' },
      { status: 500 },
    );
  }
}
