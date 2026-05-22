// POST /api/pm/draft-leases/:id/execute
//
// The linchpin Phase 3 endpoint. Wraps `leasingPromotion.executeDraftLease`
// — gate on BR-LL-11 (move-in charges paid), call the locked-period
// assertion, snapshot DraftLease → Lease, post the move-in JE, promote
// Applicants → Tenants, auto-check Stage 3 items.
import { NextResponse } from 'next/server';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  executeDraftLease,
  PromotionError,
} from '@/lib/pm/leasingPromotion';
import { LockedPeriodError } from '@/lib/pm/lockedPeriod';
import { draftLeaseExecuteSchema } from '@/lib/validation/pm/draftLease';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body OK
  }
  const parsed = draftLeaseExecuteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const result = await executeDraftLease(params.id, ctx, {
      postingDate: parsed.data.postingDate,
      overrideLockedPeriod: parsed.data.overrideLockedPeriod,
    });
    return NextResponse.json(
      {
        ok: true,
        leaseId: result.leaseId,
        leaseNumber: result.leaseNumber,
        journalEntryId: result.journalEntryId,
        alreadyExecuted: result.alreadyExecuted,
      },
      { status: result.alreadyExecuted ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof LockedPeriodError) {
      return NextResponse.json(
        { error: err.policyMessage, policyId: err.policyId },
        { status: 423 },
      );
    }
    if (err instanceof PromotionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : 'Execute failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
