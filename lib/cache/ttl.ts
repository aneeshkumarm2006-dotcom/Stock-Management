// Centralized cache TTLs + provider quota config (single source of truth).
// Refs: PDR.md §7 (External API Mapping — Cache TTL column), §8 (rate-limit
// strategy: soft 80% / hard 95%); Tech_Stack.md §External APIs, §Data Fetching.
//
// Every api-client method references a value here so TTLs are never inlined.

import type { ApiProvider } from '@/lib/db/models/ApiUsage';

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Cache TTLs in **seconds**, one per PDR §7 row.
 *
 * `quote` and `timeSeries` are split because PDR §7 specifies different TTLs
 * depending on market state / candle granularity — callers pick the right one
 * via {@link quoteTtl} / {@link timeSeriesTtl} rather than hard-coding.
 */
export const TTL = {
  /** Live quote while a US/CA exchange is open. PDR §7: 1 min. */
  quoteMarketOpen: 1 * MIN,
  /** Live quote while markets are closed. PDR §7: 1 hr. */
  quoteMarketClosed: 1 * HOUR,
  /** Intraday time_series (1W view, hourly candles). PDR §7: 1 hr. */
  timeSeriesIntraday: 1 * HOUR,
  /** Daily time_series (1M–1Y views, daily candles). PDR §7: 24 hr. */
  timeSeriesDaily: 24 * HOUR,
  /** Symbol search typeahead. PDR §7: 7 days. */
  symbolSearch: 7 * DAY,
  /** Index batch quote (S&P/NASDAQ/Dow/TSX/TSXV/VIX/USDCAD). PDR §7: 5 min. */
  indices: 5 * MIN,
  /** Gainers / losers / most-active. PDR §7: 15 min. */
  movers: 15 * MIN,
  /** Sector ETF heatmap. PDR §7: 5 min. */
  heatmap: 5 * MIN,
  /** Company profile (logo/name/sector/industry). PDR §7: 7 days. */
  profile: 7 * DAY,
  /** USD ↔ CAD FX rate. PDR §7: 24 hr. */
  fx: 24 * HOUR,
} as const;

/**
 * Quota soft/hard thresholds (PDR §8).
 * - At ≥ 80% of the daily quota, surface a warning (via `/api/usage`, Stage 13).
 * - At ≥ 95%, `withCache` force-returns cached payload with `stale: true`
 *   instead of calling the provider, regardless of TTL.
 */
export const QUOTA_SOFT_RATIO = 0.8;
export const QUOTA_HARD_RATIO = 0.95;

/**
 * Per-provider quota metadata. `dailyLimit` is the value the `withCache`
 * hard-stop is evaluated against (number of `credits` for Twelve Data, number
 * of `calls` otherwise).
 *
 * Notes on the unusual providers:
 * - **finnhub** is rate-limited at 60 *calls/minute* (PDR §5.7), not a daily
 *   volume cap. Per-minute throttling is out of Stage 4 scope (the per-minute
 *   usage bar is built in Stage 13); we still record daily calls and expose
 *   `callsPerMinute` for that panel, but do not hard-stop a 7-day-cached,
 *   low-volume metadata fetch on a daily quota it does not have →
 *   `dailyLimit: null`.
 * - **exchangerate** is 1,500 *calls/month* (PDR §5.7). We derive a
 *   conservative effective daily limit (1500 / 31) so the 80/95% rule still
 *   protects the monthly budget when evaluated per day.
 */
export const QUOTAS: Record<
  ApiProvider,
  {
    /** Field on the ApiUsage doc the quota is measured in. */
    meter: 'credits' | 'calls';
    /** Daily limit for the hard/soft ratio, or null = no daily hard-stop. */
    dailyLimit: number | null;
    /** Human-facing limit description for `/api/usage` (Stage 13). */
    label: string;
    /** Finnhub-only: requests/min ceiling surfaced in the usage panel. */
    callsPerMinute?: number;
    /** Exchange Rate-only: monthly ceiling surfaced in the usage panel. */
    callsPerMonth?: number;
  }
> = {
  twelvedata: {
    meter: 'credits',
    dailyLimit: 800,
    label: '800 credits/day',
  },
  finnhub: {
    meter: 'calls',
    dailyLimit: null,
    label: '60 calls/min',
    callsPerMinute: 60,
  },
  exchangerate: {
    meter: 'calls',
    dailyLimit: Math.floor(1500 / 31),
    label: '1,500 calls/month',
    callsPerMonth: 1500,
  },
};

/**
 * Are the US/CA equity exchanges (NYSE/NASDAQ/TSX) currently open?
 * v1 rule (PDR §10): Mon–Fri, 09:30–16:00 America/New_York, **no holiday
 * calendar**. Stage 14 builds the richer `lib/utils/marketHours.ts`; this
 * self-contained copy keeps Stage 4 free of forward dependencies and is only
 * used to choose the quote TTL.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  // Decompose `now` in the America/New_York zone (handles EST/EDT for us).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  // `formatToParts` can emit "24" for midnight in hour12:false; normalize.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const minutes = hour * 60 + minute;

  const open = 9 * 60 + 30; // 09:30 ET
  const close = 16 * 60; // 16:00 ET
  return minutes >= open && minutes < close;
}

/** Quote TTL: short while the market is open, long while closed (PDR §7). */
export function quoteTtl(now?: Date): number {
  return isMarketOpen(now) ? TTL.quoteMarketOpen : TTL.quoteMarketClosed;
}

/** Time-series TTL by candle granularity (PDR §7). */
export function timeSeriesTtl(granularity: 'intraday' | 'daily'): number {
  return granularity === 'intraday'
    ? TTL.timeSeriesIntraday
    : TTL.timeSeriesDaily;
}
