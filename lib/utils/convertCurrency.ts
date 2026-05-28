// Multi-currency conversion driven by the Exchange Rate API's USD-based
// rate table (`getFxRate().rates` — 1 USD = rates[XYZ] XYZ). Any currency
// the provider returns on the free tier (~161 ISO codes) is supported.
// All portfolio aggregations convert to the display currency BEFORE summing
// (PDR §9); position rows still show their native-currency flag.
// Refs: PDR.md §9; lib/api-clients/exchangerate.ts.

export type Currency = string;

/** Multiply `amount` (USD) by `rates[CCY]` to get CCY; divide to go back. */
export type FxRates = Record<string, number>;

/**
 * Convert via USD as the bridge: amount_to = amount_from / rates[from] * rates[to].
 * Falls back to the input amount if either rate is missing or invalid so the
 * UI stays sane when the FX cache is cold.
 */
export function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency,
  rates: FxRates,
): number {
  if (!Number.isFinite(amount)) return amount;
  const a = from?.toUpperCase();
  const b = to?.toUpperCase();
  if (!a || !b || a === b) return amount;

  const r = rates ?? {};
  const fromRate = a === 'USD' ? 1 : r[a];
  const toRate = b === 'USD' ? 1 : r[b];
  if (
    typeof fromRate !== 'number' ||
    typeof toRate !== 'number' ||
    !Number.isFinite(fromRate) ||
    !Number.isFinite(toRate) ||
    fromRate <= 0 ||
    toRate <= 0
  ) {
    return amount;
  }
  // Bridge through USD.
  return (amount / fromRate) * toRate;
}

/** Convenience: native value → the user's chosen display currency. */
export function toDisplayCurrency(
  amount: number,
  native: Currency,
  display: Currency,
  rates: FxRates,
): number {
  return convertCurrency(amount, native, display, rates);
}

/** Back-compat helper: build a USD-anchored rate table from the historical
 *  single USD→CAD number. Lets older callers that still hand around just the
 *  CAD rate keep working until they're migrated. */
export function ratesFromUsdToCad(usdToCad: number): FxRates {
  if (!Number.isFinite(usdToCad) || usdToCad <= 0) return { USD: 1 };
  return { USD: 1, CAD: usdToCad };
}
