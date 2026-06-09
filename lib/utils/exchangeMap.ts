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
