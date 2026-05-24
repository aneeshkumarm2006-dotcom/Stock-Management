"use client";

// Dashboard KPI strip (PDR §5.2) — four-card layout mirroring the design
// reference (_stock_dashboard.html § cols-4 stat-grid): Portfolio value /
// Total invested / Overall P&L / Today's change. Every figure is already
// in the display currency (computePortfolio converted it — PDR §9). The
// USD/CAD display toggle lives in the TopBar (Stage 6) and reflows these
// reactively.
import { TrendingUp, TrendingDown } from "lucide-react";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { Stat } from "@/components/ui/stat";

export function StatStrip({ summary }: { summary: PortfolioSummary }) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const cur = summary.displayCurrency;
  const fmt = (v: number, signed = false) =>
    formatCurrency(v, cur, { format: numberFormat, signed });
  const pct = (v: number) => formatPercent(v, { format: numberFormat });

  const pnlUp = summary.totalPnl >= 0;
  const dayUp = summary.todaysChange >= 0;

  // Exchange + position-count footnote for the Total invested card.
  const byExchange = summary.positions.reduce<Record<string, number>>(
    (acc, p) => {
      acc[p.exchange] = (acc[p.exchange] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const exchangeSummary = Object.entries(byExchange)
    .map(([ex, n]) => `${n} ${ex}`)
    .join(" · ");
  const investedSub = exchangeSummary
    ? `${summary.positionCount} ${
        summary.positionCount === 1 ? "asset" : "assets"
      } · ${exchangeSummary}`
    : "Cost basis";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Portfolio value"
        value={fmt(summary.totalValue)}
        sub={`${cur} · live valuation`}
      />
      <Stat
        label="Total invested"
        value={fmt(summary.totalInvested)}
        sub={investedSub}
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
            {pct(summary.totalPnlPct)} all-time
          </>
        }
      />
      <Stat
        label="Day change"
        value={
          <span className={dayUp ? "text-gain" : "text-loss"}>
            {fmt(summary.todaysChange, true)}
          </span>
        }
        tone={dayUp ? "pos" : "neg"}
        sub={
          <>
            {dayUp ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {pct(summary.todaysChangePct)} today
          </>
        }
      />
    </div>
  );
}
