// Exchange/currency lookup tables + the Twelve Data venue mapper, extracted
// from the original AddPositionPanel so the equity add/edit forms can share
// them. Twelve Data returns a human `exchange` label ("NYSE Arca") and an ISO
// 10383 `mic_code` ("ARCX"); we translate both to one of the venue keys in
// finnhub.ts EXCHANGE_META so the async profile fetch picks the right ticker
// suffix (.TO, .L, .DE, …). Unknown venues pass through uppercased.

export const MIC_TO_VENUE: Record<string, string> = {
  // North America
  XNYS: "NYSE",
  ARCX: "ARCA",
  XASE: "AMEX",
  BATS: "BATS",
  IEXG: "NYSE",
  XCBO: "BATS",
  EDGX: "BATS",
  EDGA: "BATS",
  OOTC: "OTC",
  XNAS: "NASDAQ",
  XTSE: "TSX",
  XTSX: "TSXV",
  XCNQ: "CSE",
  NEOE: "NEO",
  XCNX: "CSE",
  // Europe
  XLON: "LSE",
  XETR: "XETRA",
  XFRA: "FRANKFURT",
  XPAR: "PARIS",
  XAMS: "AMSTERDAM",
  XBRU: "BRUSSELS",
  XMIL: "MILAN",
  XMAD: "MADRID",
  XLIS: "LISBON",
  XSTO: "STOCKHOLM",
  XHEL: "HELSINKI",
  XOSL: "OSLO",
  XCSE: "COPENHAGEN",
  XSWX: "SIX",
  XWBO: "VIENNA",
  XWAR: "WARSAW",
  XIST: "ISTANBUL",
  // Asia-Pacific
  XASX: "ASX",
  XNZE: "NZX",
  XTKS: "TSE",
  XHKG: "HKEX",
  XSHG: "SSE",
  XSHE: "SZSE",
  XKRX: "KRX",
  XKOS: "KOSDAQ",
  XTAI: "TWSE",
  XSES: "SGX",
  XNSE: "NSE",
  XBOM: "BSE",
  XBKK: "SET",
  XIDX: "IDX",
  XKLS: "KLSE",
  // Americas (ex-NA)
  BVMF: "B3",
  XMEX: "BMV",
  XBUE: "BCBA",
  // Middle East / Africa
  XTAE: "TASE",
  XSAU: "TADAWUL",
  XJSE: "JSE",
};

export const LABEL_TO_VENUE: Record<string, string> = {
  "NYSE ARCA": "ARCA",
  "NYSE AMERICAN": "AMEX",
  AMEX: "AMEX",
  BATS: "BATS",
  CBOE: "BATS",
  IEX: "NYSE",
  OTC: "OTC",
  "TSX VENTURE": "TSXV",
  TSXV: "TSXV",
  NEO: "NEO",
  CSE: "CSE",
};

/**
 * Reverse of {@link MIC_TO_VENUE}: our canonical venue key → the ISO 10383 MIC
 * Twelve Data accepts on `/quote` & `/time_series`. First MIC wins when several
 * map to one venue (e.g. XNYS over IEXG for NYSE), so each venue gets its
 * primary listing code. Built once at module load.
 *
 * Why this exists: we store the venue *key* on a Position (e.g. "ARCA", "TSX"),
 * not Twelve Data's own exchange label — so forwarding that key straight back
 * as the `exchange` param fails for venues whose key isn't a TD-recognized
 * string (NYSE Arca, Toronto, …). Sending the unambiguous MIC instead fixes it.
 */
export const VENUE_TO_MIC: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [mic, venue] of Object.entries(MIC_TO_VENUE)) {
    if (!(venue in out)) out[venue] = mic;
  }
  return out;
})();

/**
 * Twelve Data query params that pin a quote/series to the right venue.
 * - NYSE/NASDAQ → `{}`: they're TD's global default, so US tickers without an
 *   exchange suffix still match (sending a param can wrongly exclude them).
 * - A venue we know the MIC for → `{ mic_code }`: the unambiguous identifier.
 * - Anything else → `{ exchange }`: best-effort passthrough for venues the user
 *   typed manually or that predate the MIC table.
 */
export function exchangeQueryParams(
  exchange: string,
): { exchange?: string; mic_code?: string } {
  const e = (exchange ?? "").trim().toUpperCase();
  if (!e) return {};
  if (e === "NYSE" || e === "NASDAQ") return {};
  const mic = VENUE_TO_MIC[e];
  if (mic) return { mic_code: mic };
  return { exchange };
}

export function mapExchange(raw: string, mic?: string): string {
  if (mic) {
    const m = MIC_TO_VENUE[mic.toUpperCase()];
    if (m) return m;
  }
  const e = raw.trim().toUpperCase();
  if (LABEL_TO_VENUE[e]) return LABEL_TO_VENUE[e];
  if (e.includes("NASDAQ")) return "NASDAQ";
  if (e.includes("NYSE")) return "NYSE";
  if (e.includes("TSX")) return "TSX";
  return e || "NYSE";
}

// Common venue suggestions for the datalist; user can still type anything.
export const COMMON_EXCHANGES = [
  "NYSE",
  "NASDAQ",
  "AMEX",
  "ARCA",
  "BATS",
  "OTC",
  "TSX",
  "TSXV",
  "NEO",
  "CSE",
  "LSE",
  "XETRA",
  "PARIS",
  "AMSTERDAM",
  "MILAN",
  "MADRID",
  "SIX",
  "ASX",
  "TSE",
  "HKEX",
  "NSE",
  "BSE",
  "SGX",
  "KRX",
  "B3",
  "BMV",
];

export const COMMON_CURRENCIES = [
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CHF",
  "HKD",
  "SGD",
  "INR",
  "CNY",
  "KRW",
  "BRL",
  "MXN",
  "ZAR",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
];
