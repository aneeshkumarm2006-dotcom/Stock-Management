// Twelve Data client — quotes, time series, symbol search, indices, market
// movers, sector ETFs. Every method is cached + usage-tracked via withCache.
// Refs: PDR.md §7 (endpoints + TTLs), §8; Tech_Stack.md §External APIs.
//
// Server-only: TWELVE_DATA_API_KEY is never sent to the browser. Twelve Data
// bills in *credits*; batch quotes cost one credit per symbol, so `cost` is
// set accordingly for the daily-quota gate.

import {
  TTL,
  quoteTtl,
  timeSeriesTtl,
  isMarketOpen,
} from '@/lib/cache/ttl';
import {
  withCache,
  priceCacheStore,
  historicalCacheStore,
  type CacheResult,
} from '@/lib/cache/withCache';
import type { IPriceCache } from '@/lib/db/models/PriceCache';
import type { HistoricalRange, ICandle } from '@/lib/db/models/HistoricalCache';

const BASE = 'https://api.twelvedata.com';

export type QuotePayload = Omit<IPriceCache, 'fetchedAt'>;

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  /** ISO-style MIC code from Twelve Data when present (e.g. ARCX, BATS, XNAS).
   *  Lets the UI map sub-exchanges (NYSE Arca, BATS) back to a storable parent. */
  micCode?: string;
  country: string;
  currency: string;
  instrumentType: string;
}

export interface MoverRow {
  symbol: string;
  name: string;
  price: number;
  change: number;
  percentChange: number;
  volume: number;
}

export interface IndexQuote {
  key: string;
  symbol: string;
  label: string;
  price: number;
  change: number;
  percentChange: number;
}

export interface SectorEtfQuote {
  etf: string;
  sector: string;
  price: number;
  percentChange: number;
}

function apiKey(): string {
  const k = process.env.TWELVE_DATA_API_KEY;
  if (!k) throw new Error('TWELVE_DATA_API_KEY is not set');
  return k;
}

/** Twelve Data disambiguates cross-listings with an explicit `exchange` code.
 *  NYSE/NASDAQ are the global default — omit them so US tickers without an
 *  exchange suffix still match. For every other listing (TSX, LSE, HKEX, NSE,
 *  ASX, Euronext, XETRA, …) we forward whatever the symbol-search returned so
 *  the right venue is queried. */
function exchangeParam(exchange: string): string | undefined {
  if (!exchange) return undefined;
  const e = exchange.toUpperCase();
  if (e === 'NYSE' || e === 'NASDAQ') return undefined;
  return exchange;
}

/**
 * Low-level Twelve Data GET. Adds the api key, parses JSON, and throws on the
 * provider's `{ status: 'error' }` envelope so `withCache` can fall back to a
 * cached value (PDR §11).
 */
async function tdFetch<T>(
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('apikey', apiKey());

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Twelve Data HTTP ${res.status} for ${path}`);
  }
  const json = (await res.json()) as unknown;
  if (
    json &&
    typeof json === 'object' &&
    'status' in json &&
    (json as { status?: string }).status === 'error'
  ) {
    const msg = (json as { message?: string }).message ?? 'unknown error';
    throw new Error(`Twelve Data error: ${msg}`);
  }
  return json as T;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const optNum = (v: unknown): number | undefined => {
  const n = num(v);
  return Number.isFinite(n) ? n : undefined;
};

interface RawQuote {
  symbol?: string;
  name?: string;
  close?: string | number;
  change?: string | number;
  percent_change?: string | number;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  volume?: string | number;
  fifty_two_week?: { high?: string | number; low?: string | number };
}

function mapQuote(
  raw: RawQuote,
  ticker: string,
  exchange: string,
): QuotePayload {
  const price = num(raw.close);
  const dayChange = num(raw.change);
  const dayChangePct = num(raw.percent_change);
  if (!Number.isFinite(price)) {
    throw new Error(`Twelve Data quote missing price for ${ticker}`);
  }
  return {
    ticker: ticker.toUpperCase(),
    exchange,
    price,
    dayChange: Number.isFinite(dayChange) ? dayChange : 0,
    dayChangePct: Number.isFinite(dayChangePct) ? dayChangePct : 0,
    high52w: optNum(raw.fifty_two_week?.high),
    low52w: optNum(raw.fifty_two_week?.low),
    open: optNum(raw.open),
    high: optNum(raw.high),
    low: optNum(raw.low),
    volume: optNum(raw.volume),
  };
}

/** Live quote for one symbol → cached in `priceCache` (PDR §7: 1m/1h). */
export async function getQuote(
  ticker: string,
  exchange: string,
  forceRefresh = false,
): Promise<CacheResult<QuotePayload>> {
  const sym = ticker.toUpperCase();
  return withCache<QuotePayload>({
    key: `quote:${exchange}:${sym}`,
    ttlSeconds: quoteTtl(),
    provider: 'twelvedata',
    cost: 1,
    forceRefresh,
    store: priceCacheStore(sym, exchange),
    fetcher: async () => {
      const raw = await tdFetch<RawQuote>('/quote', {
        symbol: sym,
        exchange: exchangeParam(exchange),
      });
      return mapQuote(raw, sym, exchange);
    },
  });
}

const RANGE_PLAN: Record<
  HistoricalRange,
  { interval: string; outputsize: number; granularity: 'intraday' | 'daily' }
> = {
  '1W': { interval: '1h', outputsize: 40, granularity: 'intraday' },
  '1M': { interval: '1day', outputsize: 23, granularity: 'daily' },
  '3M': { interval: '1day', outputsize: 66, granularity: 'daily' },
  '6M': { interval: '1day', outputsize: 130, granularity: 'daily' },
  '1Y': { interval: '1day', outputsize: 260, granularity: 'daily' },
};

interface RawSeries {
  values?: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
  }>;
}

/** OHLCV series for a range → cached in `historicalCache` (PDR §7). */
export async function getTimeSeries(
  ticker: string,
  exchange: string,
  range: HistoricalRange,
  forceRefresh = false,
): Promise<CacheResult<{ candles: ICandle[] }>> {
  const sym = ticker.toUpperCase();
  const plan = RANGE_PLAN[range];
  return withCache<{ candles: ICandle[] }>({
    key: `series:${exchange}:${sym}:${range}`,
    ttlSeconds: timeSeriesTtl(plan.granularity),
    provider: 'twelvedata',
    cost: 1,
    forceRefresh,
    store: historicalCacheStore(sym, exchange, range),
    fetcher: async () => {
      const raw = await tdFetch<RawSeries>('/time_series', {
        symbol: sym,
        exchange: exchangeParam(exchange),
        interval: plan.interval,
        outputsize: String(plan.outputsize),
        order: 'ASC',
      });
      const candles: ICandle[] = (raw.values ?? []).map((v) => ({
        time: new Date(v.datetime),
        open: num(v.open),
        high: num(v.high),
        low: num(v.low),
        close: num(v.close),
        volume: optNum(v.volume) ?? 0,
      }));
      if (candles.length === 0) {
        throw new Error(`Twelve Data returned no candles for ${sym} ${range}`);
      }
      return { candles };
    },
  });
}

interface RawSearch {
  data?: Array<{
    symbol: string;
    instrument_name: string;
    exchange: string;
    mic_code?: string;
    country: string;
    currency: string;
    instrument_type: string;
  }>;
}

/** Maps Twelve Data's verbose country names to ISO-2 codes for the UI/badges.
 *  Anything not in this table is forwarded through unchanged so we don't drop
 *  rows for missing entries — the user still sees the listing. */
const COUNTRY_ISO2: Record<string, string> = {
  'United States': 'US',
  Canada: 'CA',
  'United Kingdom': 'GB',
  Germany: 'DE',
  France: 'FR',
  Netherlands: 'NL',
  Belgium: 'BE',
  Italy: 'IT',
  Spain: 'ES',
  Switzerland: 'CH',
  Sweden: 'SE',
  Norway: 'NO',
  Denmark: 'DK',
  Finland: 'FI',
  Ireland: 'IE',
  Portugal: 'PT',
  Austria: 'AT',
  Australia: 'AU',
  'New Zealand': 'NZ',
  Japan: 'JP',
  'Hong Kong': 'HK',
  Singapore: 'SG',
  China: 'CN',
  India: 'IN',
  'South Korea': 'KR',
  Taiwan: 'TW',
  Thailand: 'TH',
  Malaysia: 'MY',
  Indonesia: 'ID',
  Philippines: 'PH',
  Vietnam: 'VN',
  Brazil: 'BR',
  Mexico: 'MX',
  Argentina: 'AR',
  Chile: 'CL',
  Colombia: 'CO',
  'South Africa': 'ZA',
  Israel: 'IL',
  'United Arab Emirates': 'AE',
  'Saudi Arabia': 'SA',
  Turkey: 'TR',
  Poland: 'PL',
  Russia: 'RU',
};

function iso2(country: string): string {
  return COUNTRY_ISO2[country] ?? country;
}

/** Symbol-search typeahead. Returns every listing Twelve Data finds (any
 *  exchange, any instrument type — Common Stock, ETF, Index, REIT, Mutual
 *  Fund, etc.). The free tier inherently excludes non-tradeable instruments
 *  like GICs, savings accounts and private holdings (no public ticker), so
 *  those still need a separate manual-asset path. (PDR §7: 7d cache.) */
export async function searchSymbols(
  query: string,
): Promise<CacheResult<SymbolSearchResult[]>> {
  const q = query.trim().toLowerCase();
  return withCache<SymbolSearchResult[]>({
    key: `search:${q}`,
    ttlSeconds: TTL.symbolSearch,
    provider: 'twelvedata',
    cost: 1,
    fetcher: async () => {
      const raw = await tdFetch<RawSearch>('/symbol_search', { symbol: q });
      return (raw.data ?? []).map((d) => ({
        symbol: d.symbol,
        name: d.instrument_name,
        exchange: d.exchange,
        micCode: d.mic_code,
        country: iso2(d.country),
        currency: d.currency,
        instrumentType: d.instrument_type,
      }));
    },
  });
}

/** Symbols for the index strip (PDR §5.2, §5.5). Twelve Data gates raw index
 *  symbols (GSPC/IXIC/DJI/VIX) behind the Pro/Venture plan, so on the free
 *  plan we track the liquid ETF that mirrors each index instead — SPY≈S&P 500,
 *  QQQ≈NASDAQ-100, DIA≈Dow, EWC≈Canadian market, VIXY≈VIX. USD/CAD is a forex
 *  pair and free on every plan. The caller still degrades gracefully per
 *  missing key. (TSX Venture has no free ETF proxy and is omitted.) */
const INDEX_SYMBOLS: Array<{ key: string; symbol: string; label: string }> = [
  { key: 'sp500', symbol: 'SPY', label: 'S&P 500 (SPY)' },
  { key: 'nasdaq', symbol: 'QQQ', label: 'NASDAQ-100 (QQQ)' },
  { key: 'dow', symbol: 'DIA', label: 'Dow Jones (DIA)' },
  { key: 'tsx', symbol: 'EWC', label: 'Canada (EWC)' },
  { key: 'vix', symbol: 'VIXY', label: 'VIX (VIXY)' },
  { key: 'usdcad', symbol: 'USD/CAD', label: 'USD/CAD' },
];

/** Batch index quotes → `marketDataCache` key `indices` (PDR §7: 5m). */
export async function getIndices(
  forceRefresh = false,
): Promise<CacheResult<IndexQuote[]>> {
  const symbols = INDEX_SYMBOLS.map((i) => i.symbol).join(',');
  return withCache<IndexQuote[]>({
    key: 'indices',
    ttlSeconds: TTL.indices,
    provider: 'twelvedata',
    cost: INDEX_SYMBOLS.length, // batch quote = 1 credit/symbol
    forceRefresh,
    fetcher: async () => {
      const raw = await tdFetch<Record<string, RawQuote>>('/quote', {
        symbol: symbols,
      });
      return INDEX_SYMBOLS.flatMap((i) => {
        const q = raw[i.symbol];
        const price = q ? num(q.close) : NaN;
        if (!q || !Number.isFinite(price)) return [];
        return [
          {
            key: i.key,
            symbol: i.symbol,
            label: i.label,
            price,
            change: Number.isFinite(num(q.change)) ? num(q.change) : 0,
            percentChange: Number.isFinite(num(q.percent_change))
              ? num(q.percent_change)
              : 0,
          },
        ];
      });
    },
  });
}

interface RawMovers {
  values?: Array<{
    symbol: string;
    name: string;
    price?: string | number;
    last?: string | number;
    change?: string | number;
    percent_change?: string | number;
    volume?: string | number;
  }>;
}

function mapMovers(raw: RawMovers): MoverRow[] {
  return (raw.values ?? []).map((v) => ({
    symbol: v.symbol,
    name: v.name,
    price: optNum(v.price) ?? optNum(v.last) ?? 0,
    change: optNum(v.change) ?? 0,
    percentChange: optNum(v.percent_change) ?? 0,
    volume: optNum(v.volume) ?? 0,
  }));
}

/** Gainers / losers (US) → `marketDataCache` (PDR §7: 15m). */
export async function getMarketMovers(
  direction: 'gainers' | 'losers',
  forceRefresh = false,
): Promise<CacheResult<MoverRow[]>> {
  return withCache<MoverRow[]>({
    key: `movers:${direction}`,
    ttlSeconds: TTL.movers,
    provider: 'twelvedata',
    cost: 1,
    forceRefresh,
    fetcher: async () => {
      const raw = await tdFetch<RawMovers>('/market_movers/stocks', {
        direction,
        outputsize: '30',
      });
      return mapMovers(raw);
    },
  });
}

/**
 * Most active by volume. Twelve Data has no dedicated "active" endpoint on the
 * free tier, so we merge the gainers + losers movers feeds and re-rank by
 * volume — a documented free-tier approximation (PDR §5.5 §4). Still one cached
 * row keyed `active`.
 */
export async function getMostActive(
  forceRefresh = false,
): Promise<CacheResult<MoverRow[]>> {
  return withCache<MoverRow[]>({
    key: 'active',
    ttlSeconds: TTL.movers,
    provider: 'twelvedata',
    cost: 2, // two underlying movers calls
    forceRefresh,
    fetcher: async () => {
      const [g, l] = await Promise.all([
        tdFetch<RawMovers>('/market_movers/stocks', {
          direction: 'gainers',
          outputsize: '30',
        }),
        tdFetch<RawMovers>('/market_movers/stocks', {
          direction: 'losers',
          outputsize: '30',
        }),
      ]);
      const merged = [...mapMovers(g), ...mapMovers(l)];
      const seen = new Set<string>();
      return merged
        .filter((r) => (seen.has(r.symbol) ? false : seen.add(r.symbol)))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 20);
    },
  });
}

/** 11 GICS SPDR sector ETFs for the heatmap (PDR §5.5 §3, §7: 5m). */
const SECTOR_ETFS: Array<{ etf: string; sector: string }> = [
  { etf: 'XLK', sector: 'Information Technology' },
  { etf: 'XLF', sector: 'Financials' },
  { etf: 'XLV', sector: 'Health Care' },
  { etf: 'XLE', sector: 'Energy' },
  { etf: 'XLI', sector: 'Industrials' },
  { etf: 'XLY', sector: 'Consumer Discretionary' },
  { etf: 'XLP', sector: 'Consumer Staples' },
  { etf: 'XLB', sector: 'Materials' },
  { etf: 'XLRE', sector: 'Real Estate' },
  { etf: 'XLU', sector: 'Utilities' },
  { etf: 'XLC', sector: 'Communication Services' },
];

/** Sector ETF % changes → `marketDataCache` key `heatmap` (PDR §7: 5m). */
export async function getSectorEtfs(
  forceRefresh = false,
): Promise<CacheResult<SectorEtfQuote[]>> {
  const symbols = SECTOR_ETFS.map((s) => s.etf).join(',');
  return withCache<SectorEtfQuote[]>({
    key: 'heatmap',
    ttlSeconds: TTL.heatmap,
    provider: 'twelvedata',
    cost: SECTOR_ETFS.length,
    forceRefresh,
    fetcher: async () => {
      const raw = await tdFetch<Record<string, RawQuote>>('/quote', {
        symbol: symbols,
      });
      return SECTOR_ETFS.flatMap((s) => {
        const q = raw[s.etf];
        const price = q ? num(q.close) : NaN;
        if (!q || !Number.isFinite(price)) return [];
        return [
          {
            etf: s.etf,
            sector: s.sector,
            price,
            percentChange: Number.isFinite(num(q.percent_change))
              ? num(q.percent_change)
              : 0,
          },
        ];
      });
    },
  });
}

/** Re-exported so callers can label data freshness without re-importing. */
export { isMarketOpen };
