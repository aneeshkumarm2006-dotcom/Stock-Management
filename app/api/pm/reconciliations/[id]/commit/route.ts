// POST /api/pm/reconciliations/[id]/commit — wizard's Step 3.
// Accepts { serviceChargeCents?, interestEarnedCents? } in cents
// (already-converted by the wizard; we don't trust dollar inputs at
// commit time). Returns 423 when statement vs book differ, 200 with
// commit result on success.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { commitReconciliation } from '@/lib/pm/reconciliation';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const commitSchema = z.object({
  serviceChargeCents: z.number().int().min(0).optional(),
  interestEarnedCents: z.number().int().min(0).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = commitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const result = await commitReconciliation({
      orgId: ctx.orgId,
      ctx,
      reconciliationId: params.id,
      serviceChargeCents: parsed.data.serviceChargeCents,
      interestEarnedCents: parsed.data.interestEarnedCents,
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Reconciliation',
      parentId: result.reconciliationId,
      eventType: 'Reconciliation committed',
      actorUserId: ctx.userId,
      payload: {
        bookEndingBalance: result.bookEndingBalance,
        lockedPeriodPolicyId: result.lockedPeriodPolicyId,
        clearedCount: result.clearedCount,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to commit';
    // Math-mismatch errors come from commitReconciliation as plain
    // throws — surface them as 423 Locked rather than 500.
    const status = /differ|Cannot commit/.test(msg) ? 423 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
