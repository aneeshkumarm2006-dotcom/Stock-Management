// Gainers & losers (US). Cached 15 min inside getMarketMovers (Stage 4).
//
// PDR §5.5 §2 wants three market-cap tiers (Large/Mid/Small). Twelve Data's
// free `/market_movers/stocks` feed carries no market-cap field, so cap-tier
// segmentation is not available on the free tier — we return the flat gainers
// and losers lists and flag `capTiersAvailable: false` so Stage 11 can render
// a single tier and degrade gracefully (a documented free-tier limitation,
// consistent with the getMostActive precedent).
// Refs: PDR.md §5.5, §7, §11.
import { NextResponse } from 'next/server';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getMarketMovers } from '@/lib/api-clients/twelvedata';
import { wantsRefresh } from '@/lib/utils/refreshParam';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  try {
    const refresh = wantsRefresh(request);
    const [gainers, losers] = await Promise.all([
      getMarketMovers('gainers', refresh),
      getMarketMovers('losers', refresh),
    ]);
    return NextResponse.json({
      gainers: gainers.data,
      losers: losers.data,
      capTiersAvailable: false,
      stale: gainers.stale || losers.stale,
      fetchedAt: gainers.fetchedAt,
      cached: gainers.cached && losers.cached,
    });
  } catch (err) {
    console.error('movers: fetch failed', err);
    return NextResponse.json(
      { error: 'Movers temporarily unavailable' },
      { status: 502 },
    );
  }
}
