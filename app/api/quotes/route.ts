// Batch live quotes for many held symbols in ONE request and ONE serverless
// invocation. Replaces the per-holding `/api/quote/{exchange}/{ticker}`
// fan-out, where a dashboard/portfolio load fired ~one request per equity
// holding at once — each its own Vercel instance, each opening its own Mongo
// connection pool — and blew the Atlas Flex connection cap (DB_CONNECTION_ISSUE.md).
//
// Cached + quota-gated inside getQuotes (Stage 4); this handler authenticates,
// parses the `symbols` list, and returns one envelope per symbol so the UI can
// still flag stale data (PDR §11). Always 200 (per-symbol failures degrade to
// stale/null) so one bad ticker can't 502 the whole page.
// Refs: PDR.md §5.2, §5.4, §7, §11.
import { NextResponse } from 'next/server';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getQuotes } from '@/lib/api-clients/twelvedata';
import { wantsRefresh } from '@/lib/utils/refreshParam';

export const runtime = 'nodejs';

/** Hard cap so a malformed/huge `symbols` param can't fan a single call out. */
const MAX_SYMBOLS = 250;

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const raw = new URL(request.url).searchParams.get('symbols') ?? '';

  // Each entry is "EXCHANGE:TICKER"; neither contains a colon, so split once.
  const pairs = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const idx = s.indexOf(':');
      if (idx <= 0) return null;
      const exchange = s.slice(0, idx).trim().toUpperCase();
      const ticker = s.slice(idx + 1).trim().toUpperCase();
      if (!exchange || !ticker) return null;
      return { exchange, ticker };
    })
    .filter((p): p is { exchange: string; ticker: string } => p !== null)
    .slice(0, MAX_SYMBOLS);

  if (pairs.length === 0) {
    return NextResponse.json({ quotes: [], stale: false });
  }

  try {
    const results = await getQuotes(pairs, wantsRefresh(request));
    return NextResponse.json({
      quotes: results.map((r) => ({
        ticker: r.ticker,
        exchange: r.exchange,
        data: r.data,
        stale: r.stale,
        fetchedAt: r.fetchedAt ? r.fetchedAt.toISOString() : null,
      })),
      stale: results.some((r) => r.stale),
    });
  } catch (err) {
    // getQuotes degrades per symbol, so this only fires on an unexpected
    // (e.g. DB-connect) failure with no cache to fall back to.
    console.error('quotes: batch fetch failed', err);
    return NextResponse.json(
      { error: 'Quotes temporarily unavailable' },
      { status: 502 },
    );
  }
}
