// Historical OHLCV for the candlestick chart. Range comes from `?range=`
// (1W/1M/3M/6M/1Y, default 1M). Cached + quota-gated in getTimeSeries.
// Refs: PDR.md §5.4, §7, §11; Tech_Stack.md §Charts, §Folder Structure.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getTimeSeries } from '@/lib/api-clients/twelvedata';
import { wantsRefresh } from '@/lib/utils/refreshParam';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  exchange: z.enum(['NYSE', 'NASDAQ', 'TSX']),
  ticker: z.string().trim().toUpperCase().min(1).max(12),
});
const rangeSchema = z.enum(['1W', '1M', '3M', '6M', '1Y']).default('1M');

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

  const rangeParsed = rangeSchema.safeParse(
    new URL(request.url).searchParams.get('range') ?? undefined,
  );
  if (!rangeParsed.success) {
    return NextResponse.json(
      { error: 'Invalid range (use 1W, 1M, 3M, 6M, or 1Y)' },
      { status: 400 },
    );
  }

  try {
    const result = await getTimeSeries(
      parsed.data.ticker,
      parsed.data.exchange,
      rangeParsed.data,
      wantsRefresh(request),
    );
    return NextResponse.json({ ...result, range: rangeParsed.data });
  } catch (err) {
    console.error('history: fetch failed', parsed.data, rangeParsed.data, err);
    return NextResponse.json(
      { error: 'History temporarily unavailable' },
      { status: 502 },
    );
  }
}
