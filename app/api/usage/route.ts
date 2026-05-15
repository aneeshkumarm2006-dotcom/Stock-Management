// API usage vs quota for the Settings status panel (PDR §5.7). Returns each
// provider's used/limit/ratio plus soft(80%)/hard(95%) flags from
// getAllQuotaStatus (Stage 4). Per-minute Finnhub + per-month Exchange Rate
// ceilings are surfaced for the Stage 13 bars.
// Refs: PDR.md §5.7, §8, §11.
import { NextResponse } from 'next/server';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getAllQuotaStatus } from '@/lib/cache/withCache';
import { QUOTAS } from '@/lib/cache/ttl';

export const runtime = 'nodejs';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  try {
    const statuses = await getAllQuotaStatus();
    const providers = statuses.map((s) => ({
      ...s,
      callsPerMinute: QUOTAS[s.provider].callsPerMinute ?? null,
      callsPerMonth: QUOTAS[s.provider].callsPerMonth ?? null,
    }));
    return NextResponse.json({ providers });
  } catch (err) {
    console.error('usage: lookup failed', err);
    return NextResponse.json(
      { error: 'Usage data temporarily unavailable' },
      { status: 502 },
    );
  }
}
