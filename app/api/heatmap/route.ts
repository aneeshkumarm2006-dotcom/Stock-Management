// US sector heatmap — 11 GICS SPDR sector ETF % changes. Batched + cached
// (5 min) inside getSectorEtfs (Stage 4).
// Refs: PDR.md §5.5 §3, §7, §11.
import { NextResponse } from 'next/server';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getSectorEtfs } from '@/lib/api-clients/twelvedata';
import { wantsRefresh } from '@/lib/utils/refreshParam';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  try {
    return NextResponse.json(await getSectorEtfs(wantsRefresh(request)));
  } catch (err) {
    console.error('heatmap: fetch failed', err);
    return NextResponse.json(
      { error: 'Heatmap temporarily unavailable' },
      { status: 502 },
    );
  }
}
