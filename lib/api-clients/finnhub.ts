// Finnhub client — company profile (logo, name, sector, industry).
// Refs: PDR.md §7 (/stock/profile2, 7d cache), §5.1; Tech_Stack.md §External APIs.
//
// Server-only: FINNHUB_API_KEY never reaches the browser. Free tier exposes a
// single `finnhubIndustry` field, so `sector` and `industry` are both mapped
// from it (documented limitation). Listing country is derived from the
// exchange (PDR §6 `country` = US/CA listing), not Finnhub's HQ `country`.

import { TTL } from '@/lib/cache/ttl';
import {
  withCache,
  stockMetadataStore,
  type CacheResult,
} from '@/lib/cache/withCache';
import type { IStockMetadata, Country } from '@/lib/db/models/StockMetadata';

const BASE = 'https://finnhub.io/api/v1';

export type ProfilePayload = Omit<IStockMetadata, 'lastUpdated'>;

function apiKey(): string {
  const k = process.env.FINNHUB_API_KEY;
  if (!k) throw new Error('FINNHUB_API_KEY is not set');
  return k;
}

/** US for NYSE/NASDAQ, CA for TSX (PDR §6 listing country). */
function countryFor(exchange: string): Country {
  return exchange === 'TSX' ? 'CA' : 'US';
}

/** Finnhub symbol form: TSX listings use the `.TO` suffix. */
function finnhubSymbol(ticker: string, exchange: string): string {
  const t = ticker.toUpperCase();
  return exchange === 'TSX' ? `${t}.TO` : t;
}

interface RawProfile {
  name?: string;
  logo?: string;
  finnhubIndustry?: string;
}

/**
 * Company profile → cached in `stockMetadata` (PDR §7: 7 days). Fired async
 * after a position is added (PDR §5.1) and read by the stock-detail page.
 */
export async function getProfile(
  ticker: string,
  exchange: string,
  forceRefresh = false,
): Promise<CacheResult<ProfilePayload>> {
  const sym = ticker.toUpperCase();
  return withCache<ProfilePayload>({
    key: `profile:${exchange}:${sym}`,
    ttlSeconds: TTL.profile,
    provider: 'finnhub',
    cost: 1,
    forceRefresh,
    store: stockMetadataStore(sym, exchange),
    fetcher: async () => {
      const url = new URL(`${BASE}/stock/profile2`);
      url.searchParams.set('symbol', finnhubSymbol(sym, exchange));
      url.searchParams.set('token', apiKey());

      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Finnhub HTTP ${res.status} for ${sym}`);
      }
      const raw = (await res.json()) as RawProfile;
      // Finnhub returns `{}` for unknown symbols — treat as a miss so the
      // wrapper can fall back to any previously cached value (PDR §11).
      if (!raw || (!raw.name && !raw.logo && !raw.finnhubIndustry)) {
        throw new Error(`Finnhub profile empty for ${sym}`);
      }
      return {
        ticker: sym,
        exchange,
        name: raw.name,
        logo: raw.logo,
        sector: raw.finnhubIndustry,
        industry: raw.finnhubIndustry,
        country: countryFor(exchange),
      };
    },
  });
}
