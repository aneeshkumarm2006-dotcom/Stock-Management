// Company profile (logo / name / sector / industry) for one symbol. Wraps the
// Stage 4 cached + quota-gated `getProfile` (Finnhub, 7d StockMetadata cache).
// The stock-detail page reads this so the header is populated even for symbols
// the user does NOT hold — the lazy fetch the Stage 5 note anticipated, which
// also self-heals a dropped fire-and-forget metadata fetch from `POST
// /api/positions`. Returns the Stage 4 cache envelope so the UI can flag stale
// data (PDR §11). Server-only: FINNHUB_API_KEY never reaches the browser.
// Refs: PDR.md §5.4, §7, §11; Tech_Stack.md §Folder Structure.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getProfile } from '@/lib/api-clients/finnhub';
import { wantsRefresh } from '@/lib/utils/refreshParam';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  exchange: z.enum(['NYSE', 'NASDAQ', 'TSX']),
  ticker: z.string().trim().toUpperCase().min(1).max(12),
});

export async function GET(
  request: Request,
  { params }: { params: { exchange: string; ticker: string } },
) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const parsed = paramsSchema.safeParse({
    exchange: params.exchange?.toUpperCase(),
    ticker: params.ticker,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid exchange or ticker' },
      { status: 400 },
    );
  }

  try {
    const result = await getProfile(
      parsed.data.ticker,
      parsed.data.exchange,
      wantsRefresh(request),
    );
    return NextResponse.json(result);
  } catch (err) {
    // Unknown symbol / provider down with no cached fallback (PDR §11). The
    // page degrades to ticker + exchange + price, so this is non-fatal: a 404
    // lets the client distinguish "no profile" from a transport failure.
    console.error('profile: fetch failed', parsed.data, err);
    return NextResponse.json(
      { error: 'Company profile unavailable' },
      { status: 404 },
    );
  }
}
