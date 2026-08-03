"use client";

// Renders a currency-tagged total (MoneyByCurrency) as ONE number in the user's
// display currency.
//
// Use this anywhere a figure aggregates across properties. A plain
// <CurrencyAmount> takes a single native currency, which is wrong for a total
// spanning a CAD building and a USD one — each bucket has to be converted
// before they are added. Server routes hand back the buckets; this component
// does the conversion and the sum.
// Refs: lib/pm/moneyByCurrency.ts.
import * as React from "react";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { useSettingsStore } from "@/store/useSettingsStore";
import { usePmCurrency } from "./PmCurrencyProvider";
import {
  convertTotals,
  isMixed,
  type MoneyByCurrency,
} from "@/lib/pm/moneyByCurrency";
import { cn } from "@/lib/utils/cn";

export function MoneyTotal({
  totals,
  accounting = true,
  decimals,
  signed,
  className,
}: {
  totals: MoneyByCurrency | null | undefined;
  accounting?: boolean;
  decimals?: number;
  signed?: boolean;
  className?: string;
}) {
  const format = useSettingsStore((s) => s.numberFormat);
  const pm = usePmCurrency();

  const display = pm?.displayCurrency ?? "USD";
  const cents = convertTotals(totals, display, pm?.rates ?? {});
  const dollars = cents / 100;
  const negative = dollars < 0;

  // A mixed total genuinely depends on the FX table. Until it loads,
  // convertTotals soft-falls back to a raw sum of unlike units — flag it rather
  // than presenting a confident wrong number.
  const unconverted = isMixed(totals) && pm != null && !pm.ratesReady;

  return (
    <span
      className={cn(
        "tabular-nums",
        negative && accounting && "text-loss",
        unconverted && "opacity-60",
        className,
      )}
      title={
        unconverted
          ? "Exchange rates still loading — this total mixes currencies and is not yet converted."
          : undefined
      }
    >
      {formatCurrency(dollars, display, {
        format,
        decimals,
        signed,
        accounting,
      })}
    </span>
  );
}

export default MoneyTotal;
