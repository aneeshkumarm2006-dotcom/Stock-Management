// Cron entry — Vercel Cron (or external scheduler) hits this daily; the
// worker scans active RecurringTasks AND escalates past-due Tasks
// (Phase 5 [G-B-34]). Mirrors the post-recurring route (Phase 4) for
// auth and response shape.
import { NextResponse } from 'next/server';
import { runRecurringTaskPoster } from '@/lib/pm/recurringTaskPoster';
import { escalatePastDueTasks } from '@/lib/pm/taskNotifications';

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
  const posterResults = await runRecurringTaskPoster();
  const escalation = await escalatePastDueTasks();
  const posted = posterResults.filter((r) => r.posted).length;
  return NextResponse.json({
    recurringTasks: {
      ran: posterResults.length,
      posted,
      skipped: posterResults.length - posted,
      results: posterResults,
    },
    escalation,
  });
}

export const POST = GET;
