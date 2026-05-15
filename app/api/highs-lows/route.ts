// 52-week highs / lows (US + TSX), tabbed in Stage 11.
//
// Twelve Data's free tier exposes no 52-week highs/lows endpoint, and per-symbol
// 52w checks would cost one credit each. Consistent with the documented
// getMostActive free-tier approximation, we proxy the lists from the daily
// gainers (→ highs) and losers (→ lows) feeds, which are already cached under
// the `movers:*` keys so this adds no extra Twelve Data credits. The response
// sets `approximation: true` so Stage 11 labels it honestly. TSX movers are
// not on the free tier, so `ca` is empty and flagged `caAvailable: false`.
// Refs: PDR.md §5.5 §5, §7, §11.
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
    const [highs, lows] = await Promise.all([
      getMarketMovers('gainers', refresh),
      getMarketMovers('losers', refresh),
    ]);
    return NextResponse.json({
      us: { highs: highs.data, lows: lows.data },
      ca: { highs: [], lows: [] },
      caAvailable: false,
      approximation: true,
      stale: highs.stale || lows.stale,
      fetchedAt: highs.fetchedAt,
      cached: highs.cached && lows.cached,
    });
  } catch (err) {
    console.error('highs-lows: fetch failed', err);
    return NextResponse.json(
      { error: '52-week highs/lows temporarily unavailable' },
      { status: 502 },
    );
  }
}
