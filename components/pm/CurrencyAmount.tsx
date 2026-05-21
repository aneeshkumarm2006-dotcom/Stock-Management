// Accounting-style currency renderer (BR-AC-12). Renders negatives as
// `($X.XX)` in the red `text-loss` colour; non-negatives unchanged. Reads
// the user's numberFormat preference from the existing Settings store so a
// PM tenant who prefers `1.234,56` sees consistent grouping.
"use client";

import * as React from "react";
import { formatCurrency, type Currency } from "@/lib/utils/formatCurrency";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cn } from "@/lib/utils/cn";

interface CurrencyAmountProps {
  value: number | null | undefined;
  currency?: Currency;
  /**
   * Defaults to true — every PM money cell uses the accounting variant. Pass
   * `accounting={false}` to fall back to the stocks-style `-$X.XX` rendering.
   */
  accounting?: boolean;
  decimals?: number;
  /** Hide the leading currency symbol (column-labelled tables). */
  hideSymbol?: boolean;
  signed?: boolean;
  className?: string;
}

export function CurrencyAmount({
  value,
  currency = "USD",
  accounting = true,
  decimals,
  hideSymbol,
  signed,
  className,
}: CurrencyAmountProps) {
  const format = useSettingsStore((s) => s.numberFormat);
  const negative = typeof value === "number" && Number.isFinite(value) && value < 0;

  const text = formatCurrency(value, currency, {
    format,
    decimals,
    hideSymbol,
    signed,
    accounting,
  });

  return (
    <span
      className={cn(
        "tabular-nums",
        negative && accounting && "text-loss",
        className,
      )}
    >
      {text}
    </span>
  );
}

export default CurrencyAmount;
