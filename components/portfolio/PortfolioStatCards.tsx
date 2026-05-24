"use client";

// Portfolio page stat strip. Layout follows the design reference (compact
// aggregate totals row): Total value · Total invested · Total P&L · Total
// return. All monetary figures come from computePortfolio and are already in
// the display currency (PDR §9 — currency reflows reactively from the TopBar
// USD/CAD toggle).
import { TrendingUp, TrendingDown } from "lucide-react";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { Stat } from "@/components/ui/stat";

export function PortfolioStatCards({
  summary,
}: {
  summary: PortfolioSummary;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const cur = summary.displayCurrency;
  const fmt = (v: number, signed = false) =>
    formatCurrency(v, cur, { format: numberFormat, signed });
  const pct = (v: number) => formatPercent(v, { format: numberFormat });

  const pnlUp = summary.totalPnl >= 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Total value"
        value={fmt(summary.totalValue)}
        sub={`${cur} · live valuation`}
      />
      <Stat
        label="Total invested"
        value={fmt(summary.totalInvested)}
        sub="Cost basis"
      />
      <Stat
        label="Total P&L"
        value={
          <span className={pnlUp ? "text-gain" : "text-loss"}>
            {fmt(summary.totalPnl, true)}
          </span>
        }
        tone={pnlUp ? "pos" : "neg"}
        sub={
          <>
            {pnlUp ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            from cost basis
          </>
        }
      />
      <Stat
        label="Total return"
        value={
          <span className={pnlUp ? "text-gain" : "text-loss"}>
            {pct(summary.totalPnlPct)}
          </span>
        }
        tone={pnlUp ? "pos" : "neg"}
        sub="all-time"
      />
    </div>
  );
}
