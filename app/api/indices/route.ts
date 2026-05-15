// Index strip — S&P 500, NASDAQ, Dow, TSX, TSX Venture, VIX, USD/CAD.
// Batched + cached (5 min) inside getIndices (Stage 4).
// Refs: PDR.md §5.2, §5.5, §7, §11.
import { NextResponse } from 'next/server';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getIndices } from '@/lib/api-clients/twelvedata';
import { wantsRefresh } from '@/lib/utils/refreshParam';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  try {
    return NextResponse.json(await getIndices(wantsRefresh(request)));
  } catch (err) {
    console.error('indices: fetch failed', err);
    return NextResponse.json(
      { error: 'Indices temporarily unavailable' },
      { status: 502 },
    );
  }
}
