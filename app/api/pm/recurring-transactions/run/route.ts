// Session-authed "Run poster now" endpoint. Lets an authenticated user
// manually trigger the recurring poster for THEIR org only (org-scoped via
// ctx.orgId), instead of hitting the cron endpoint which is guarded by the
// shared CRON_SECRET and runs across all tenants. The cron entry point
// (app/api/cron/post-recurring/route.ts) remains the scheduler's target.
//
// CATCH-UP. With no body this behaves exactly as it always has — one period
// per due rule — so the existing "Run poster now" button is untouched. Pass
// `throughDate` to walk rules forward through every period up to that date
// (the Jan–Jul backfill case), and `dryRun` to preview without writing.
//
// Backfilling a closed month is a controller action, so `throughDate` requires
// the same role that can override a locked period. The preview is read-only
// and open to any authenticated user — seeing what WOULD post is useful to a
// bookkeeper who cannot post it.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  runRecurringPoster,
  planRecurringCatchUp,
} from '@/lib/pm/recurringPoster';
import { canOverrideLockedPeriod } from '@/lib/pm/roles';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';
// A multi-period × multi-rule apply run comfortably exceeds the default
// serverless timeout.
export const maxDuration = 300;

/** Refuse a throughDate this far back — a fat-fingered year would otherwise
 *  enumerate decades of history (the per-rule cap bounds it, but the intent is
 *  clearly wrong). */
const MAX_BACKFILL_YEARS = 3;

const runBodySchema = z.object({
  throughDate: z.string().datetime().or(z.string().date()).optional(),
  dryRun: z.boolean().optional(),
  ruleIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
  maxPeriodsPerRule: z.number().int().min(1).max(60).optional(),
});

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  // No body at all is the legacy call shape; treat it as "run today's sweep".
  let raw: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = runBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { throughDate: throughRaw, dryRun, ruleIds, maxPeriodsPerRule } =
    parsed.data;

  let throughDate: Date | null = null;
  if (throughRaw) {
    throughDate = new Date(throughRaw);
    if (Number.isNaN(throughDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid throughDate' },
        { status: 400 },
      );
    }
    const now = new Date();
    if (throughDate > now) {
      return NextResponse.json(
        { error: 'throughDate cannot be in the future.' },
        { status: 400 },
      );
    }
    const floor = new Date(now);
    floor.setFullYear(floor.getFullYear() - MAX_BACKFILL_YEARS);
    if (throughDate < floor) {
      return NextResponse.json(
        {
          error: `throughDate cannot be more than ${MAX_BACKFILL_YEARS} years in the past.`,
        },
        { status: 400 },
      );
    }
  }

  try {
    // Preview — read-only, no role gate.
    if (throughDate && dryRun) {
      const plan = await planRecurringCatchUp(ctx.orgId, throughDate, {
        ruleIds,
        maxPeriodsPerRule,
      });
      return NextResponse.json({ dryRun: true, ...plan });
    }

    if (throughDate && !canOverrideLockedPeriod(ctx)) {
      return NextResponse.json(
        {
          error:
            'Posting recurring transactions for past periods requires the Financial Administrator role.',
        },
        { status: 403 },
      );
    }

    const results = await runRecurringPoster(ctx.orgId, new Date(), {
      ...(throughDate ? { throughDate } : {}),
      ...(ruleIds ? { ruleIds } : {}),
      ...(maxPeriodsPerRule ? { maxPeriodsPerRule } : {}),
      // Only a catch-up runs as the human. The plain sweep keeps the role-less
      // system context so it can never override a locked period.
      ...(throughDate ? { actorCtx: ctx } : {}),
    });
    const posted = results.filter((r) => r.posted).length;

    if (throughDate && posted > 0) {
      // One entry per rule, so each rule's own Event history records what its
      // catch-up did rather than burying it in a single org-level row.
      const perRule = new Map<string, number>();
      for (const r of results) {
        if (!r.posted) continue;
        perRule.set(
          r.recurringTransactionId,
          (perRule.get(r.recurringTransactionId) ?? 0) + 1,
        );
      }
      for (const [ruleId, periods] of Array.from(perRule.entries())) {
        await logActivity({
          orgId: ctx.orgId,
          parentType: 'RecurringTransaction',
          parentId: ruleId,
          eventType: 'Recurring transaction caught up',
          actorUserId: ctx.userId,
          payload: {
            throughDate: throughDate.toISOString(),
            periodsPosted: periods,
          },
        });
      }
    }

    // A locked or skipped period is reported, not thrown — a partial run must
    // stay inspectable rather than collapsing to a 423.
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
