// Live quote for one symbol. Cached + quota-gated inside getQuote (Stage 4);
// this handler just authenticates, validates the path, and returns the cache
// envelope so the UI can show a stale indicator (PDR §11).
// Refs: PDR.md §5.2, §5.4, §7, §11; Tech_Stack.md §Folder Structure.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getQuote } from '@/lib/api-clients/twelvedata';
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
    const result = await getQuote(
      parsed.data.ticker,
      parsed.data.exchange,
      wantsRefresh(request),
    );
    return NextResponse.json(result);
  } catch (err) {
    // No cache to fall back to and the provider failed (PDR §11): inline error.
    console.error('quote: fetch failed', parsed.data, err);
    return NextResponse.json(
      { error: 'Quote temporarily unavailable' },
      { status: 502 },
    );
  }
}
