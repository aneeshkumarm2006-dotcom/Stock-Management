// POST /api/pm/reconciliations/[id]/void — undo a Completed
// reconciliation. Resets `cleared` flags on all linked JE lines,
// deactivates the LockedPeriodPolicy, and rolls back
// BankAccount.lastReconciliationDate to the prior Completed run.
import { NextResponse } from 'next/server';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { voidReconciliation } from '@/lib/pm/reconciliation';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  try {
    await voidReconciliation({
      orgId: ctx.orgId,
      ctx,
      reconciliationId: params.id,
    });
    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Reconciliation',
      parentId: params.id,
      eventType: 'Reconciliation voided',
      actorUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to void';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
