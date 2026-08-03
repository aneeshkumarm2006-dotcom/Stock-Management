// Accounting-style currency renderer (BR-AC-12). Renders negatives as
// `($X.XX)` in the red `text-loss` colour; non-negatives unchanged. Reads
// the user's numberFormat preference from the existing Settings store so a
// PM tenant who prefers `1.234,56` sees consistent grouping.
//
// CURRENCY CONVERSION. Amounts handed to this component are in their NATIVE
// currency — the one the property books in. Inside a <PmCurrencyProvider> the
// value is converted to the user's selected display currency and rendered with
// that symbol. The native currency comes from, in order: the `currency` prop,
// the surrounding <PmNativeCurrency> scope, then the org default. Outside a
// provider (e.g. reused by the stock workspace) behaviour is unchanged: label
// with `currency`, convert nothing.
//
// Pass `convert={false}` for figures a server route already converted, so they
// are not converted twice.
"use client";

import * as React from "react";
import { formatCurrency, type Currency } from "@/lib/utils/formatCurrency";
import { useSettingsStore } from "@/store/useSettingsStore";
import { usePmCurrency } from "./PmCurrencyProvider";
import { cn } from "@/lib/utils/cn";
import type { PmCurrency } from "@/types/pm";

interface CurrencyAmountProps {
  /** Pre-converted dollar value (legacy API). */
  value?: number | null | undefined;
  /** Integer-cents shorthand — Phase 3 leasing pages pass cents directly so
   *  the call site doesn't have to thread `fromCents` everywhere. Equivalent
   *  to `value={cents / 100}`. */
  cents?: number | null | undefined;
  /**
   * NATIVE currency of this amount — what it is denominated in, not what to
   * render it as. Omit to inherit the enclosing <PmNativeCurrency> scope,
   * which is the normal case.
   */
  currency?: Currency;
  /**
   * Set false when the amount has already been converted to the display
   * currency upstream (server-side aggregates that must convert before summing).
   */
  convert?: boolean;
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
  cents,
  currency,
  convert = true,
  accounting = true,
  decimals,
  hideSymbol,
  signed,
  className,
}: CurrencyAmountProps) {
  const format = useSettingsStore((s) => s.numberFormat);
  const pm = usePmCurrency();

  const dollars = cents != null && Number.isFinite(cents) ? cents / 100 : value;

  // Outside the PM provider this collapses to the historical behaviour:
  // `currency ?? "USD"` as a pure label, no conversion.
  let amount = dollars;
  let renderCurrency: Currency = currency ?? "USD";

  if (pm) {
    // `currency` is the wide stock-side Currency type; the PM ledger only books
    // USD/CAD, so anything else falls back to the scope's native currency
    // rather than being handed to the converter as an unknown code.
    const native: PmCurrency =
      currency === "USD" || currency === "CAD" ? currency : pm.nativeCurrency;
    renderCurrency = convert ? pm.displayCurrency : native;
    if (convert && typeof dollars === "number" && Number.isFinite(dollars)) {
      // Convert in the ledger's own unit so the result lands on a whole cent.
      amount = pm.convert(Math.round(dollars * 100), native) / 100;
    }
  }

  const negative =
    typeof amount === "number" && Number.isFinite(amount) && amount < 0;

  const text = formatCurrency(amount, renderCurrency, {
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
