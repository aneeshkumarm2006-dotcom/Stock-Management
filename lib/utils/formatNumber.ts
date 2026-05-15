// Locale-aware number formatting honoring the user's Settings.numberFormat
// preference (PDR §5.7). The three supported formats map to grouping/decimal
// separators only — the rest of the app stays language-neutral.
// Refs: PDR.md §5.7, §9; lib/db/models/Settings.ts (NumberFormat).

export type NumberFormat = "1,234.56" | "1.234,56" | "1234.56";

export const DEFAULT_NUMBER_FORMAT: NumberFormat = "1,234.56";

interface FormatNumberOptions {
  format?: NumberFormat;
  /** Fixed fraction digits. Default 2. */
  decimals?: number;
  /** Drop grouping separators regardless of format. */
  noGrouping?: boolean;
  /** Prefix non-negative values with an explicit "+" (for P&L deltas). */
  signed?: boolean;
  /** Compact notation (1.2K, 3.4M) — used for volume/market cap. */
  compact?: boolean;
}

/** Internal: separators for each supported format. */
function separators(format: NumberFormat): {
  group: string;
  decimal: string;
} {
  switch (format) {
    case "1.234,56":
      return { group: ".", decimal: "," };
    case "1234.56":
      return { group: "", decimal: "." };
    case "1,234.56":
    default:
      return { group: ",", decimal: "." };
  }
}

export function formatNumber(
  value: number | null | undefined,
  options: FormatNumberOptions = {},
): string {
  const {
    format = DEFAULT_NUMBER_FORMAT,
    decimals = 2,
    noGrouping = false,
    signed = false,
    compact = false,
  } = options;

  if (value == null || !Number.isFinite(value)) return "—";

  const negative = value < 0;
  const abs = Math.abs(value);
  const { group, decimal } = separators(format);

  let body: string;
  if (compact) {
    // Compact notation, then swap the decimal separator to match the format.
    body = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    })
      .format(abs)
      .replace(".", decimal);
  } else {
    const fixed = abs.toFixed(decimals);
    const dotIndex = fixed.indexOf(".");
    const intPart = dotIndex === -1 ? fixed : fixed.slice(0, dotIndex);
    const fracPart = dotIndex === -1 ? "" : fixed.slice(dotIndex + 1);

    const grouped =
      noGrouping || group === ""
        ? intPart
        : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);

    body = fracPart ? `${grouped}${decimal}${fracPart}` : grouped;
  }

  const sign = negative ? "-" : signed ? "+" : "";
  return `${sign}${body}`;
}

/** Percentage with a trailing "%" (e.g. +24.25%). Always signed. */
export function formatPercent(
  value: number | null | undefined,
  options: Omit<FormatNumberOptions, "compact"> = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, { decimals: 2, signed: true, ...options })}%`;
}
