// Financials reconciliation endpoint — bridges the Bills list and the P&L
// matrix. Returns every non-Voided bill that is NOT reflected in Financials
// plus a per-reason summary, so the UI can answer "why isn't my bill here?"
// (drafts, voided/missing JEs, non-P&L accounts, archived-property scope, or —
// when from/to is supplied — simply outside the selected window).
//
// Read-only; org-scoped via getPmContext. The classification logic lives in
// `lib/pm/billReflection.ts` and mirrors the matrix route exactly.
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { classifyBills } from '@/lib/pm/billReflection';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  await connectToDatabase();
  const { unreflected, summary } = await classifyBills({
    orgId: ctx.orgId,
    from,
    to,
  });

  return NextResponse.json({ unreflected, summary });
}
