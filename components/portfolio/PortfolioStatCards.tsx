"use client";

// Portfolio page stat cards (PDR §5.3): best performer (highest P&L %),
// worst performer (lowest P&L %), highest-value position, largest-weight
// position. Derived in usePortfolio; all monetary figures are already in the
// display currency (computePortfolio — PDR §9).
import { TrendingUp, TrendingDown, Crown, Scale } from "lucide-react";
import type { PortfolioStats } from "@/lib/hooks/usePortfolio";
import type { Currency } from "@/lib/utils/convertCurrency";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cn } from "@/lib/utils/cn";

function Card({
  label,
  ticker,
  children,
}: {
  label: string;
  ticker: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-high p-5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-fg-muted">
        {label}
      </p>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-2xl font-bold text-fg">{ticker}</h3>
        {children}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-high p-5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-fg-muted">
        {label}
      </p>
      <p className="font-display text-2xl font-bold text-fg-muted">—</p>
    </div>
  );
}

export function PortfolioStatCards({
  stats,
  displayCurrency,
}: {
  stats: PortfolioStats;
  displayCurrency: Currency;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const pct = (v: number) => formatPercent(v, { format: numberFormat });
  const money = (v: number) =>
    formatCurrency(v, displayCurrency, { format: numberFormat, compact: true });

  const { bestPerformer, worstPerformer, highestValue, largestWeight } = stats;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {bestPerformer ? (
        <Card label="Best Performer" ticker={bestPerformer.ticker}>
          <span className="flex items-center gap-1 rounded-full bg-gain/15 px-2 py-1 text-xs font-bold text-gain">
            <TrendingUp className="h-3 w-3" />
            {pct(bestPerformer.metrics.pnlPct)}
          </span>
        </Card>
      ) : (
        <Empty label="Best Performer" />
      )}

      {worstPerformer ? (
        <Card label="Worst Performer" ticker={worstPerformer.ticker}>
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold",
              worstPerformer.metrics.pnlPct >= 0
                ? "bg-gain/15 text-gain"
                : "bg-loss/15 text-loss",
            )}
          >
            {worstPerformer.metrics.pnlPct >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {pct(worstPerformer.metrics.pnlPct)}
          </span>
        </Card>
      ) : (
        <Empty label="Worst Performer" />
      )}

      {highestValue ? (
        <Card label="Highest Value" ticker={highestValue.ticker}>
          <span className="flex items-center gap-1.5 font-display text-sm font-bold text-fg">
            <Crown className="h-3.5 w-3.5 text-fg-muted" />
            {money(highestValue.metrics.currentValue)}
          </span>
        </Card>
      ) : (
        <Empty label="Highest Value" />
      )}

      {largestWeight ? (
        <Card label="Largest Weight" ticker={largestWeight.ticker}>
          <span className="flex items-center gap-1.5 font-display text-sm font-bold text-fg">
            <Scale className="h-3.5 w-3.5 text-fg-muted" />
            {largestWeight.metrics.weightPct.toFixed(1)}%
          </span>
        </Card>
      ) : (
        <Empty label="Largest Weight" />
      )}
    </div>
  );
}
