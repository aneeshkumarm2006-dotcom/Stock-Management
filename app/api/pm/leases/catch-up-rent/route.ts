// POST /api/pm/leases/catch-up-rent — recover lease rent for PAST periods.
//
// The lease counterpart of /api/pm/recurring-transactions/run, and gated the
// same way: the preview is read-only and open to any authenticated user
// (seeing what WOULD post is useful to a bookkeeper who cannot post it), while
// actually writing into closed months is a controller action and needs the role
// that can override a locked period.
//
// Static segment, so it sits beside `leases/[id]` without shadowing it — the
// catch-up spans many leases and belongs to the collection, not to one lease.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPmContext, unauthorizedResponse } from "@/lib/auth/getCurrentUser";
import {
  planLeaseRentCatchUp,
  runLeaseRentCatchUp,
} from "@/lib/pm/leaseRentCatchUp";
import { canOverrideLockedPeriod } from "@/lib/pm/roles";

export const runtime = "nodejs";
// A multi-month × multi-lease apply run comfortably exceeds the default
// serverless timeout.
export const maxDuration = 300;

/** Refuse a window this far back — a fat-fingered year would otherwise
 *  enumerate decades. The per-charge cap bounds it, but the intent is clearly
 *  wrong and silently clamping it would be worse. */
const MAX_BACKFILL_YEARS = 3;

const bodySchema = z.object({
  from: z.string().datetime().or(z.string().date()),
  through: z.string().datetime().or(z.string().date()),
  leaseIds: z.array(z.string()).optional(),
  includeExpired: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { from, through, leaseIds, includeExpired } = parsed.data;
  const dryRun = parsed.data.dryRun !== false;

  const fromDate = new Date(from);
  const throughDate = new Date(through);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(throughDate.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (fromDate > throughDate) {
    return NextResponse.json(
      { error: '"From" must be on or before "Through".' },
      { status: 400 },
    );
  }
  const floor = new Date();
  floor.setFullYear(floor.getFullYear() - MAX_BACKFILL_YEARS);
  if (fromDate < floor) {
    return NextResponse.json(
      {
        error: `Rent can only be caught up ${MAX_BACKFILL_YEARS} years back. Check the "From" date.`,
      },
      { status: 400 },
    );
  }
  if (throughDate.getTime() > Date.now()) {
    return NextResponse.json(
      {
        error:
          "Rent cannot be caught up into the future — the nightly poster owns periods from today forward.",
      },
      { status: 400 },
    );
  }

  const opts = {
    orgId: ctx.orgId,
    from,
    through,
    ...(leaseIds?.length ? { leaseIds } : {}),
    ...(includeExpired ? { includeExpired } : {}),
    ctx,
  };

  try {
    if (dryRun) {
      const plan = await planLeaseRentCatchUp(opts);
      return NextResponse.json({ dryRun: true, ...plan });
    }

    if (!canOverrideLockedPeriod(ctx)) {
      return NextResponse.json(
        {
          error:
            "Posting rent for past periods requires the Financial Administrator role.",
        },
        { status: 403 },
      );
    }

    const result = await runLeaseRentCatchUp(opts);
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rent catch-up failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
