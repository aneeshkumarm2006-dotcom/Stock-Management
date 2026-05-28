// Exchange Rate API client — USD ↔ CAD conversion.
// Refs: PDR.md §7 (/latest/USD, 24h cache), §9 (currency handling);
// Tech_Stack.md §External APIs.
//
// Server-only: EXCHANGE_RATE_API_KEY never reaches the browser. Free tier is
// 1,500 calls/month; the 24h TTL keeps usage to ~31/month. Cached in
// `marketDataCache` under key `fx`.

import { TTL } from '@/lib/cache/ttl';
import { withCache, type CacheResult } from '@/lib/cache/withCache';

const BASE = 'https://v6.exchangerate-api.com/v6';

export interface FxRate {
  /** Multiply a USD amount by this to get CAD. Kept for back-compat with
   *  callers that pre-date multi-currency support. */
  usdToCad: number;
  /** Multiply a CAD amount by this to get USD. */
  cadToUsd: number;
  /** Full USD-based conversion table from the provider — `1 USD = rates[XYZ]
   *  XYZ`. Includes ~161 currencies on the free tier. Use this to convert
   *  between any two supported currencies via USD as the bridge. */
  rates: Record<string, number>;
  /** Provider's last-update timestamp (epoch ms), when available. */
  asOf: number;
}

function apiKey(): string {
  const k = process.env.EXCHANGE_RATE_API_KEY;
  if (!k) throw new Error('EXCHANGE_RATE_API_KEY is not set');
  return k;
}

interface RawLatest {
  result?: string;
  'error-type'?: string;
  time_last_update_unix?: number;
  conversion_rates?: Record<string, number>;
}

/** Live USD↔CAD rate → `marketDataCache` key `fx` (PDR §7: 24h). */
export async function getFxRate(
  forceRefresh = false,
): Promise<CacheResult<FxRate>> {
  return withCache<FxRate>({
    key: 'fx',
    ttlSeconds: TTL.fx,
    provider: 'exchangerate',
    cost: 1,
    forceRefresh,
    fetcher: async () => {
      const url = `${BASE}/${apiKey()}/latest/USD`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Exchange Rate API HTTP ${res.status}`);
      }
      const raw = (await res.json()) as RawLatest;
      if (raw.result !== 'success' || !raw.conversion_rates) {
        throw new Error(
          `Exchange Rate API error: ${raw['error-type'] ?? 'unknown'}`,
        );
      }
      const usdToCad = raw.conversion_rates.CAD;
      if (typeof usdToCad !== 'number' || !Number.isFinite(usdToCad)) {
        throw new Error('Exchange Rate API: CAD rate missing');
      }
      // Drop any non-finite values to keep the table safe to JSON-serialize.
      const rates: Record<string, number> = { USD: 1 };
      for (const [code, value] of Object.entries(raw.conversion_rates)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          rates[code] = value;
        }
      }
      return {
        usdToCad,
        cadToUsd: 1 / usdToCad,
        rates,
        asOf: (raw.time_last_update_unix ?? Date.now() / 1000) * 1000,
      };
    },
  });
}
