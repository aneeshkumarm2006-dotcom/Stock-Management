/**
 * Stage 4 scratch verification (not part of the app runtime).
 *
 * Exercises every cache collection + ApiUsage + the quota gate live:
 *   - twelvedata getQuote      → priceCache        + twelvedata usage
 *   - twelvedata getTimeSeries → historicalCache   + twelvedata usage
 *   - twelvedata searchSymbols → marketDataCache   + twelvedata usage
 *   - finnhub    getProfile    → stockMetadata     + finnhub usage
 *   - exchangerate getFxRate   → marketDataCache   + exchangerate usage
 *   - cache HIT path           → no second usage increment
 *   - forced ≥95% quota        → stale cached payload, no provider call
 *
 * The artificial over-quota figure is restored afterwards so the real
 * Twelve Data daily counter stays honest. Shared market-cache docs are left
 * in place (the app would create them anyway).
 *
 * Run from `site/`:  npx --yes tsx scripts/verify-stage4.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import ApiUsage from '../lib/db/models/ApiUsage';
import PriceCache from '../lib/db/models/PriceCache';
import { getQuotaStatus } from '../lib/cache/withCache';
import {
  getQuote,
  getTimeSeries,
  searchSymbols,
} from '../lib/api-clients/twelvedata';
import { getProfile } from '../lib/api-clients/finnhub';
import { getFxRate } from '../lib/api-clients/exchangerate';

function loadEnvLocal() {
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split(
    /\r?\n/,
  )) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const tdCredits = async () =>
  (await ApiUsage.findOne({ provider: 'twelvedata', date: today() }).lean())
    ?.credits ?? 0;

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  loadEnvLocal();
  await connectToDatabase();
  console.log('✓ connected to Atlas\n');

  // ── Twelve Data: quote → priceCache + usage ────────────────────────────
  console.log('twelvedata.getQuote(AAPL, NASDAQ)');
  const c0 = await tdCredits();
  const q1 = await getQuote('AAPL', 'NASDAQ');
  const c1 = await tdCredits();
  check('typed price returned', Number.isFinite(q1.data.price), `$${q1.data.price}`);
  check('priceCache written', !q1.stale);
  check('twelvedata usage incremented', c1 === c0 + 1, `${c0} → ${c1}`);

  const q2 = await getQuote('AAPL', 'NASDAQ');
  const c2 = await tdCredits();
  check('2nd call served from cache', q2.cached && !q2.stale);
  check('cache HIT did NOT increment usage', c2 === c1, `${c1} → ${c2}`);

  // ── Twelve Data: time_series → historicalCache ─────────────────────────
  console.log('\ntwelvedata.getTimeSeries(AAPL, NASDAQ, 1M)');
  const ts = await getTimeSeries('AAPL', 'NASDAQ', '1M');
  check(
    'candles returned & cached',
    Array.isArray(ts.data.candles) && ts.data.candles.length > 0,
    `${ts.data.candles.length} candles`,
  );

  // ── Twelve Data: symbol_search → marketDataCache ───────────────────────
  console.log('\ntwelvedata.searchSymbols("apple")');
  const search = await searchSymbols('apple');
  check(
    'US/CA results returned & cached',
    search.data.length > 0,
    `${search.data.length} hits, first=${search.data[0]?.symbol}`,
  );

  // ── Finnhub: profile → stockMetadata ───────────────────────────────────
  console.log('\nfinnhub.getProfile(AAPL, NASDAQ)');
  const prof = await getProfile('AAPL', 'NASDAQ');
  check(
    'profile typed & cached',
    Boolean(prof.data.name),
    `${prof.data.name ?? '?'} / ${prof.data.sector ?? '?'}`,
  );

  // ── Exchange Rate: fx → marketDataCache ────────────────────────────────
  console.log('\nexchangerate.getFxRate()');
  const fx = await getFxRate();
  check(
    'USD↔CAD typed & cached',
    Number.isFinite(fx.data.usdToCad) && fx.data.usdToCad > 0,
    `USD→CAD ${fx.data.usdToCad.toFixed(4)}`,
  );

  // ── Quota status helper (soft/hard flags for /api/usage) ───────────────
  console.log('\nquota status');
  const st = await getQuotaStatus('twelvedata');
  check(
    'getQuotaStatus reports twelvedata',
    st.limit === 800 && st.used >= 0,
    `used=${st.used}/${st.limit} ratio=${st.ratio.toFixed(3)} soft=${st.soft} hard=${st.hard}`,
  );

  // ── Forced ≥95% quota → stale cached payload, no provider call ──────────
  // Age the cached AAPL quote past its TTL so withCache would normally call
  // out — the quota gate must intercept and serve the stale value instead.
  console.log('\nforced over-quota (set twelvedata credits = 800)');
  await PriceCache.updateOne(
    { ticker: 'AAPL', exchange: 'NASDAQ' },
    { $set: { fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } },
  );
  const orig = await ApiUsage.findOne({
    provider: 'twelvedata',
    date: today(),
  }).lean();
  const origCredits = orig?.credits ?? 0;
  await ApiUsage.updateOne(
    { provider: 'twelvedata', date: today() },
    { $set: { credits: 800 } },
    { upsert: true },
  );
  const gated = await getQuote('AAPL', 'NASDAQ');
  const afterGate = await tdCredits();
  check('over-quota returns stale', gated.stale && gated.cached);
  check('over-quota made NO provider call', afterGate === 800, `credits=${afterGate}`);
  // restore the honest counter
  await ApiUsage.updateOne(
    { provider: 'twelvedata', date: today() },
    { $set: { credits: origCredits } },
  );
  const restored = await tdCredits();
  check('honest twelvedata counter restored', restored === origCredits, `=${restored}`);

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'}: ${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('✗ verification failed:', e);
  process.exitCode = 1;
});
