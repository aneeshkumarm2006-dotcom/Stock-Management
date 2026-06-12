// Unified cached, rate-limit-aware wrapper around every external API call.
// Refs: PDR.md §8 (caching & rate-limit strategy), §11 (over-quota → stale);
// Tech_Stack.md §Data Fetching & Caching.
//
// Flow (Tech_Stack §Data Fetching):
//   1. Read the relevant Mongo cache collection.
//   2. Fresh (now - fetchedAt < ttl)?  → return cached, no provider call.
//   3. Daily quota ≥ 95%?              → return cached `stale:true`, no call.
//   4. Else call provider, write back, increment ApiUsage, return fresh.
//   5. Provider call fails but a cached value exists → serve it `stale:true`.
//
// ── ApiUsage increment policy (spec reconciliation) ─────────────────────────
// PDR §8 says "Every *API call* increments ApiUsage"; Tech_Stack/TODO phrase it
// as "regardless of cache hit/miss". Taken literally the second phrasing would
// count cache *hits* against the quota, which would let cached reads exhaust
// the very budget caching exists to protect and make the 80/95% gate
// meaningless. We therefore increment ApiUsage only when an actual outbound
// provider request is made (miss / forced refresh) — the PDR §8 reading — so
// the quota meter reflects real provider load. Documented intentionally.

import { connectToDatabase } from '@/lib/db/mongoose';
import ApiUsage, { type ApiProvider } from '@/lib/db/models/ApiUsage';
import PriceCache, { type IPriceCache } from '@/lib/db/models/PriceCache';
import HistoricalCache, {
  type IHistoricalCache,
} from '@/lib/db/models/HistoricalCache';
import StockMetadata, {
  type IStockMetadata,
} from '@/lib/db/models/StockMetadata';
import MarketDataCache from '@/lib/db/models/MarketDataCache';
import { QUOTAS, QUOTA_HARD_RATIO, QUOTA_SOFT_RATIO } from '@/lib/cache/ttl';

/** A pluggable cache backend: read the stored value + write a fresh one. */
export interface CacheStore<T> {
  read(): Promise<{ data: T; fetchedAt: Date } | null>;
  write(data: T): Promise<void>;
}

/** Result envelope every api-client method ultimately returns. */
export interface CacheResult<T> {
  data: T;
  /** True when payload came from cache because of TTL hit, quota, or error. */
  stale: boolean;
  /** When the returned payload was originally fetched from the provider. */
  fetchedAt: Date;
  /** True when no provider call was made on this invocation. */
  cached: boolean;
}

export interface WithCacheOptions<T> {
  /** Logical cache key — used by the default MarketDataCache store + logs. */
  key: string;
  /** Freshness window in seconds (from `lib/cache/ttl.ts`). */
  ttlSeconds: number;
  /** Provider whose ApiUsage row is incremented + quota-gated. */
  provider: ApiProvider;
  /** Credits/calls this fetch costs (Twelve Data batch quotes cost N). Def 1. */
  cost?: number;
  /** Backend store. Defaults to MarketDataCache keyed by `key`. */
  store?: CacheStore<T>;
  /** Manual refresh (Stage 14): skip the freshness check, still quota-gated. */
  forceRefresh?: boolean;
  /** The actual provider request. */
  fetcher: () => Promise<T>;
}

const today = (): string => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

/** Per-day usage snapshot for one provider, with soft/hard quota flags. */
export interface QuotaStatus {
  provider: ApiProvider;
  /** Units consumed today (credits for Twelve Data, calls otherwise). */
  used: number;
  /** Daily limit the ratio is measured against, or null = no daily cap. */
  limit: number | null;
  /** used / limit, or 0 when there is no daily cap. */
  ratio: number;
  /** ≥ 80% — surface a warning (PDR §8). */
  soft: boolean;
  /** ≥ 95% — force-serve stale cache instead of calling out (PDR §8/§11). */
  hard: boolean;
  /** Human-facing limit text for the Stage 13 usage panel. */
  label: string;
}

/** Read today's quota status for a provider (used by withCache + /api/usage). */
export async function getQuotaStatus(
  provider: ApiProvider,
): Promise<QuotaStatus> {
  await connectToDatabase();
  const cfg = QUOTAS[provider];
  const doc = await ApiUsage.findOne({ provider, date: today() }).lean();
  const used = doc ? (cfg.meter === 'credits' ? doc.credits : doc.calls) : 0;
  const limit = cfg.dailyLimit;
  const ratio = limit && limit > 0 ? used / limit : 0;
  return {
    provider,
    used,
    limit,
    ratio,
    soft: limit != null && ratio >= QUOTA_SOFT_RATIO,
    hard: limit != null && ratio >= QUOTA_HARD_RATIO,
    label: cfg.label,
  };
}

/** Quota status for every provider — convenience for `/api/usage` (Stage 13). */
export async function getAllQuotaStatus(): Promise<QuotaStatus[]> {
  return Promise.all(
    (Object.keys(QUOTAS) as ApiProvider[]).map(getQuotaStatus),
  );
}

/**
 * Atomically bump today's ApiUsage row for a provider (upsert). One outbound
 * provider request = `calls += 1`; `credits += cost` (Twelve Data bills one
 * credit per symbol, so a batch quote passes `cost = symbols.length`).
 * Exported so the batched quote path can record one HTTP call covering many
 * symbols without inflating the call count.
 */
export async function incrementUsage(
  provider: ApiProvider,
  cost: number,
): Promise<void> {
  await ApiUsage.updateOne(
    { provider, date: today() },
    { $inc: { calls: 1, credits: cost } },
    { upsert: true },
  );
}

/**
 * Default key/value store backed by `marketDataCache` — used for everything
 * that does not have a structured collection (search, indices, movers,
 * heatmap, active, fx).
 */
function marketDataStore<T>(key: string): CacheStore<T> {
  return {
    async read() {
      const doc = await MarketDataCache.findOne({ key }).lean();
      if (!doc) return null;
      return { data: doc.payload as T, fetchedAt: doc.fetchedAt };
    },
    async write(data: T) {
      await MarketDataCache.updateOne(
        { key },
        { $set: { payload: data, fetchedAt: new Date() } },
        { upsert: true },
      );
    },
  };
}

/** Structured store for live quotes → `priceCache` (PDR §6). */
export function priceCacheStore(
  ticker: string,
  exchange: string,
): CacheStore<Omit<IPriceCache, 'fetchedAt'>> {
  const filter = { ticker: ticker.toUpperCase(), exchange };
  return {
    async read() {
      const doc = await PriceCache.findOne(filter).lean();
      if (!doc) return null;
      const { fetchedAt, ...data } = doc;
      return { data, fetchedAt };
    },
    async write(data) {
      await PriceCache.updateOne(
        filter,
        { $set: { ...data, ...filter, fetchedAt: new Date() } },
        { upsert: true },
      );
    },
  };
}

/** Structured store for OHLCV series → `historicalCache` (PDR §6). */
export function historicalCacheStore(
  ticker: string,
  exchange: string,
  range: IHistoricalCache['range'],
): CacheStore<Pick<IHistoricalCache, 'candles'>> {
  const filter = { ticker: ticker.toUpperCase(), exchange, range };
  return {
    async read() {
      const doc = await HistoricalCache.findOne(filter).lean();
      if (!doc) return null;
      return { data: { candles: doc.candles }, fetchedAt: doc.fetchedAt };
    },
    async write(data) {
      await HistoricalCache.updateOne(
        filter,
        { $set: { ...filter, candles: data.candles, fetchedAt: new Date() } },
        { upsert: true },
      );
    },
  };
}

/** Structured store for company profiles → `stockMetadata` (PDR §6). */
export function stockMetadataStore(
  ticker: string,
  exchange: string,
): CacheStore<Omit<IStockMetadata, 'lastUpdated'>> {
  const filter = { ticker: ticker.toUpperCase(), exchange };
  return {
    async read() {
      const doc = await StockMetadata.findOne(filter).lean();
      if (!doc) return null;
      const { lastUpdated, ...data } = doc;
      return { data, fetchedAt: lastUpdated };
    },
    async write(data) {
      await StockMetadata.updateOne(
        filter,
        { $set: { ...data, ...filter, lastUpdated: new Date() } },
        { upsert: true },
      );
    },
  };
}

/**
 * Run `fetcher` through the cache + quota pipeline. See file header for the
 * exact decision flow and the ApiUsage increment policy.
 */
export async function withCache<T>(
  opts: WithCacheOptions<T>,
): Promise<CacheResult<T>> {
  await connectToDatabase();

  const store = opts.store ?? marketDataStore<T>(opts.key);
  const cost = opts.cost ?? 1;
  const existing = await store.read();

  // (2) Fresh cache hit → return it, no provider call, no usage increment.
  if (
    existing &&
    !opts.forceRefresh &&
    Date.now() - existing.fetchedAt.getTime() < opts.ttlSeconds * 1000
  ) {
    return {
      data: existing.data,
      stale: false,
      fetchedAt: existing.fetchedAt,
      cached: true,
    };
  }

  // (3) Hard quota gate — only meaningful when we actually have a fallback.
  if (existing) {
    const quota = await getQuotaStatus(opts.provider);
    if (quota.hard) {
      return {
        data: existing.data,
        stale: true,
        fetchedAt: existing.fetchedAt,
        cached: true,
      };
    }
  }

  // (4) Miss / stale / forced → call provider, persist, count usage.
  try {
    const data = await opts.fetcher();
    await store.write(data);
    await incrementUsage(opts.provider, cost);
    return { data, stale: false, fetchedAt: new Date(), cached: false };
  } catch (err) {
    // (5) Provider failed — serve last good value if we have one (PDR §11).
    if (existing) {
      return {
        data: existing.data,
        stale: true,
        fetchedAt: existing.fetchedAt,
        cached: true,
      };
    }
    throw err;
  }
}
