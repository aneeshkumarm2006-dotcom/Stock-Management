// USD ↔ CAD conversion. `usdToCad` is the cached Exchange Rate API rate
// (`/latest/USD` → rates.CAD): 1 USD = `usdToCad` CAD. All portfolio
// aggregations convert to the display currency BEFORE summing (PDR §9);
// position rows still show their native-currency flag for transparency.
// Refs: PDR.md §9; lib/api-clients/exchangerate.ts.

export type Currency = "USD" | "CAD";

/** Convert `amount` from one currency to another using the USD→CAD rate. */
export function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency,
  usdToCad: number,
): number {
  if (from === to) return amount;
  if (!Number.isFinite(usdToCad) || usdToCad <= 0) return amount;
  if (from === "USD" && to === "CAD") return amount * usdToCad;
  // CAD → USD
  return amount / usdToCad;
}

/** Convenience: native value → the user's chosen display currency. */
export function toDisplayCurrency(
  amount: number,
  native: Currency,
  display: Currency,
  usdToCad: number,
): number {
  return convertCurrency(amount, native, display, usdToCad);
}
