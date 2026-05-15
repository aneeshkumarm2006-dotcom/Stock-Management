// Most active by volume. Cached 15 min inside getMostActive (Stage 4).
//
// PDR §5.5 §4 asks for US *and* TSX side by side. Twelve Data's free tier has
// no TSX most-active feed (and no dedicated "active" endpoint at all — see
// getMostActive's documented gainers+losers volume re-rank). We therefore
// return the US list and an empty `ca` list flagged `caAvailable: false` so
// Stage 11 renders the US column and labels TSX as unavailable on the free
// tier rather than silently dropping it.
// Refs: PDR.md §5.5 §4, §7, §11.
import { NextResponse } from 'next/server';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getMostActive } from '@/lib/api-clients/twelvedata';
import { wantsRefresh } from '@/lib/utils/refreshParam';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  try {
    const us = await getMostActive(wantsRefresh(request));
    return NextResponse.json({
      us: us.data,
      ca: [],
      caAvailable: false,
      stale: us.stale,
      fetchedAt: us.fetchedAt,
      cached: us.cached,
    });
  } catch (err) {
    console.error('active: fetch failed', err);
    return NextResponse.json(
      { error: 'Most-active temporarily unavailable' },
      { status: 502 },
    );
  }
}
