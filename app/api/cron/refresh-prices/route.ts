// Vercel Cron target — every 5 min during market hours (vercel.json) it warms
// the price cache for tickers users actually hold, so dashboards are fresh
// without users each triggering provider calls (PDR §8, §10). Guarded by a
// shared secret: `Authorization: Bearer ${CRON_SECRET}` (Tech_Stack §Security).
//
// getQuote runs through withCache, so this respects TTL freshness and the
// 95% hard-quota stop automatically; we just enumerate held symbols and let
// the cache layer decide whether an outbound call is actually needed.
// Refs: PDR.md §8, §10; Tech_Stack.md §Cron Configuration, §Security Notes.
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import { getQuote } from '@/lib/api-clients/twelvedata';

export const runtime = 'nodejs';
// Never statically optimized — must run on every cron invocation.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization');
  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();

  // Distinct {ticker, exchange} across every user's holdings — refresh shared
  // market data once per symbol, not once per position or per user.
  const held = await Position.aggregate<{
    _id: { ticker: string; exchange: string };
  }>([
    { $group: { _id: { ticker: '$ticker', exchange: '$exchange' } } },
  ]);

  let refreshed = 0;
  let failed = 0;
  for (const h of held) {
    try {
      await getQuote(h._id.ticker, h._id.exchange);
      refreshed += 1;
    } catch (err) {
      failed += 1;
      console.error('cron refresh-prices: quote failed', h._id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    symbols: held.length,
    refreshed,
    failed,
  });
}
