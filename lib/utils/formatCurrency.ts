// Currency formatting layered on formatNumber so it respects the user's
// numberFormat preference. USD → "$", CAD → "C$" so the two are always
// visually distinguishable (PDR §9 — native-currency transparency).
// Refs: PDR.md §9, §5.7.
import {
  formatNumber,
  type NumberFormat,
  DEFAULT_NUMBER_FORMAT,
} from "./formatNumber";

export type Currency = "USD" | "CAD";

const SYMBOL: Record<Currency, string> = {
  USD: "$",
  CAD: "C$",
};

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
  const symbol = hideSymbol ? "" : SYMBOL[currency];

  if (accounting && negative) {
    // Accounting style: ($1,234.56) — no leading minus, parentheses wrap.
    return `(${symbol}${formatted})`;
  }

  const sign = negative ? "-" : signed ? "+" : "";
  return `${sign}${symbol}${formatted}`;
}
