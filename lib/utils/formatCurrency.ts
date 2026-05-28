// Currency formatting layered on formatNumber so it respects the user's
// numberFormat preference. USD → "$", CAD → "C$" so the two are always
// visually distinguishable (PDR §9 — native-currency transparency).
// Refs: PDR.md §9, §5.7.
import {
  formatNumber,
  type NumberFormat,
  DEFAULT_NUMBER_FORMAT,
} from "./formatNumber";

// Currency is now any ISO-4217 code (positions can hold global listings).
// SYMBOL maps the ones we want a distinctive prefix for; anything else falls
// back to the ISO code followed by a space (e.g. "EUR 12.34") which is
// unambiguous and renders correctly without per-locale Intl noise.
export type Currency = string;

const SYMBOL: Record<string, string> = {
  USD: "$",
  CAD: "C$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  HKD: "HK$",
  AUD: "A$",
  NZD: "NZ$",
  SGD: "S$",
  CHF: "CHF ",
  SEK: "kr ",
  NOK: "kr ",
  DKK: "kr ",
  INR: "₹",
  KRW: "₩",
  BRL: "R$",
  MXN: "Mex$",
  ZAR: "R",
};

function symbolFor(currency: string): string {
  return SYMBOL[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
}

interface FormatCurrencyOptions {
  format?: NumberFormat;
  decimals?: number;
  /** Prefix non-negative values with "+" (P&L amounts). */
  signed?: boolean;
  /** Compact notation for large aggregates ($1.4M). */
  compact?: boolean;
  /** Hide the currency symbol (e.g. inside a labelled column). */
  hideSymbol?: boolean;
  /**
   * Accounting variant: render negatives as `($X.XX)` (parentheses, no
   * leading minus) per BR-AC-12. Pair with the `<CurrencyAmount>` component
   * to also apply the red `text-loss` colour.
   */
  accounting?: boolean;
}

export function formatCurrency(
  value: number | null | undefined,
  currency: Currency = "USD",
  options: FormatCurrencyOptions = {},
): string {
  const {
    format = DEFAULT_NUMBER_FORMAT,
    decimals = 2,
    signed = false,
    compact = false,
    hideSymbol = false,
    accounting = false,
  } = options;

  if (value == null || !Number.isFinite(value)) return "—";

  const negative = value < 0;
  const formatted = formatNumber(Math.abs(value), {
    format,
    decimals,
    compact,
  });
  const symbol = hideSymbol ? "" : symbolFor(currency);

  if (accounting && negative) {
    // Accounting style: ($1,234.56) — no leading minus, parentheses wrap.
    return `(${symbol}${formatted})`;
  }

  const sign = negative ? "-" : signed ? "+" : "";
  return `${sign}${symbol}${formatted}`;
}
