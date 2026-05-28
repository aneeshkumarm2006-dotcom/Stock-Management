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
import type { IStockMetadata } from '@/lib/db/models/StockMetadata';

const BASE = 'https://finnhub.io/api/v1';

export type ProfilePayload = Omit<IStockMetadata, 'lastUpdated'>;

function apiKey(): string {
  const k = process.env.FINNHUB_API_KEY;
  if (!k) throw new Error('FINNHUB_API_KEY is not set');
  return k;
}

/** Finnhub ticker-suffix + ISO-2 country for each exchange we recognise.
 *  Anything not listed defaults to a US-style bare ticker (NYSE/NASDAQ). On
 *  the free plan most non-US profiles return `{}` — we still try because (a)
 *  `getProfile` already handles empty responses as a cache miss and (b)
 *  Finnhub gradually exposes more venues. Suffix map mirrors Finnhub's
 *  `/stock/symbol` reference. */
const EXCHANGE_META: Record<string, { suffix: string; country: string }> = {
  // North America
  NYSE: { suffix: '', country: 'US' },
  NASDAQ: { suffix: '', country: 'US' },
  AMEX: { suffix: '', country: 'US' },
  ARCA: { suffix: '', country: 'US' },
  BATS: { suffix: '', country: 'US' },
  OTC: { suffix: '', country: 'US' },
  TSX: { suffix: '.TO', country: 'CA' },
  'TSX VENTURE': { suffix: '.V', country: 'CA' },
  TSXV: { suffix: '.V', country: 'CA' },
  CSE: { suffix: '.CN', country: 'CA' },
  NEO: { suffix: '.NE', country: 'CA' },
  // Europe
  LSE: { suffix: '.L', country: 'GB' },
  'LONDON STOCK EXCHANGE': { suffix: '.L', country: 'GB' },
  XETRA: { suffix: '.DE', country: 'DE' },
  FRANKFURT: { suffix: '.F', country: 'DE' },
  PARIS: { suffix: '.PA', country: 'FR' },
  EURONEXT: { suffix: '.PA', country: 'FR' },
  AMSTERDAM: { suffix: '.AS', country: 'NL' },
  BRUSSELS: { suffix: '.BR', country: 'BE' },
  MILAN: { suffix: '.MI', country: 'IT' },
  MADRID: { suffix: '.MC', country: 'ES' },
  LISBON: { suffix: '.LS', country: 'PT' },
  STOCKHOLM: { suffix: '.ST', country: 'SE' },
  HELSINKI: { suffix: '.HE', country: 'FI' },
  OSLO: { suffix: '.OL', country: 'NO' },
  COPENHAGEN: { suffix: '.CO', country: 'DK' },
  SIX: { suffix: '.SW', country: 'CH' },
  VIENNA: { suffix: '.VI', country: 'AT' },
  WARSAW: { suffix: '.WA', country: 'PL' },
  ISTANBUL: { suffix: '.IS', country: 'TR' },
  // Asia-Pacific
  ASX: { suffix: '.AX', country: 'AU' },
  NZX: { suffix: '.NZ', country: 'NZ' },
  TSE: { suffix: '.T', country: 'JP' }, // Tokyo
  HKEX: { suffix: '.HK', country: 'HK' },
  SSE: { suffix: '.SS', country: 'CN' }, // Shanghai
  SZSE: { suffix: '.SZ', country: 'CN' }, // Shenzhen
  KRX: { suffix: '.KS', country: 'KR' }, // KOSPI
  KOSDAQ: { suffix: '.KQ', country: 'KR' },
  TWSE: { suffix: '.TW', country: 'TW' },
  SGX: { suffix: '.SI', country: 'SG' },
  NSE: { suffix: '.NS', country: 'IN' },
  BSE: { suffix: '.BO', country: 'IN' },
  SET: { suffix: '.BK', country: 'TH' },
  IDX: { suffix: '.JK', country: 'ID' },
  KLSE: { suffix: '.KL', country: 'MY' },
  // Americas (ex-NA)
  B3: { suffix: '.SA', country: 'BR' },
  BMV: { suffix: '.MX', country: 'MX' },
  BCBA: { suffix: '.BA', country: 'AR' },
  // Middle East / Africa
  TASE: { suffix: '.TA', country: 'IL' },
  TADAWUL: { suffix: '.SR', country: 'SA' },
  JSE: { suffix: '.JO', country: 'ZA' },
};

function exchangeMeta(exchange: string): { suffix: string; country: string } {
  return EXCHANGE_META[exchange.toUpperCase()] ?? { suffix: '', country: 'US' };
}

function countryFor(exchange: string): string {
  return exchangeMeta(exchange).country;
}

function finnhubSymbol(ticker: string, exchange: string): string {
  const t = ticker.toUpperCase();
  const { suffix } = exchangeMeta(exchange);
  return suffix ? `${t}${suffix}` : t;
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
