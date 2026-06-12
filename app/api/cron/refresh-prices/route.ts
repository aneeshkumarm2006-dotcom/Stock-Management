// Vercel Cron target — every 5 min during market hours (vercel.json) it warms
// the price cache for tickers users actually hold, so dashboards are fresh
// without users each triggering provider calls (PDR §8, §10). Guarded by a
// shared secret: `Authorization: Bearer ${CRON_SECRET}` (Tech_Stack §Security).
//
// getQuotes runs through the same cache + quota gate, so this respects TTL
// freshness and the 95% hard-quota stop automatically; we just enumerate held
// symbols and let the cache layer decide whether an outbound call is needed.
// It fetches all misses in one batched provider call per exchange instead of a
// sequential per-symbol loop, so a cold cache no longer burns minutes serially
// retrying symbols that rate-limit (DB_CONNECTION_ISSUE.md amplifier #note).
// Refs: PDR.md §8, §10; Tech_Stack.md §Cron Configuration, §Security Notes.
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import { getQuotes } from '@/lib/api-clients/twelvedata';

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
    {
      $match: {
        ticker: { $type: 'string', $ne: '' },
        $or: [{ assetType: 'EQUITY' }, { assetType: { $exists: false } }],
      },
    },
    { $group: { _id: { ticker: '$ticker', exchange: '$exchange' } } },
  ]);

  const pairs = held
    .map((h) => ({ ticker: h._id.ticker, exchange: h._id.exchange }))
    .filter((p) => p.ticker && p.exchange);

  // Batched: one provider call per exchange, written back in bulk. A symbol
  // only counts as failed when it has no cache AND the provider call failed.
  const results = await getQuotes(pairs);
  const failed = results.filter((r) => r.data === null).length;
  const refreshed = results.length - failed;
  if (failed > 0) {
    console.error(`cron refresh-prices: ${failed}/${results.length} symbols unavailable`);
  }

  return NextResponse.json({
    ok: true,
    symbols: held.length,
    refreshed,
    failed,
  });
}
