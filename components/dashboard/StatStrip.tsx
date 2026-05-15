"use client";

// Dashboard top strip (PDR §5.2): total value, total invested, overall P&L
// ($/%), today's change ($/%), position count. Every figure is already in
// the display currency (computePortfolio converted it — PDR §9). The USD/CAD
// display toggle lives in the TopBar (Stage 6) and reflows these reactively.
import { TrendingUp, TrendingDown, Wallet, Layers } from "lucide-react";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cn } from "@/lib/utils/cn";

function Stat({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-32 flex-col justify-between rounded-md border border-border bg-surface-high p-4",
        className,
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-widest text-fg-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

export function StatStrip({ summary }: { summary: PortfolioSummary }) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const cur = summary.displayCurrency;
  const fmt = (v: number, signed = false) =>
    formatCurrency(v, cur, { format: numberFormat, signed });
  const pct = (v: number) => formatPercent(v, { format: numberFormat });

  const pnlUp = summary.totalPnl >= 0;
  const dayUp = summary.todaysChange >= 0;
  const investedPct =
    summary.totalValue > 0
      ? Math.min(
          100,
          (summary.totalInvested / summary.totalValue) * 100,
        )
      : 0;

  // Exchange breakdown for the position-count card (matches the reference).
  const byExchange = summary.positions.reduce<Record<string, number>>(
    (acc, p) => {
      acc[p.exchange] = (acc[p.exchange] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Stat label="Total Portfolio Value" className="relative overflow-hidden">
        <div className="font-display text-2xl font-bold tracking-tight text-fg">
          {fmt(summary.totalValue)}
        </div>
        <div className="text-[11px] font-medium text-fg-muted">
          {cur} · live valuation
        </div>
        <Wallet className="absolute -bottom-3 -right-3 h-16 w-16 text-fg opacity-[0.04]" />
      </Stat>

      <Stat label="Total Invested">
        <div className="font-display text-2xl font-bold tracking-tight text-fg">
          {fmt(summary.totalInvested)}
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[10px] font-bold text-fg-muted">
            <span>Cost basis</span>
            <span className="text-primary">{investedPct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${investedPct}%` }}
            />
          </div>
        </div>
      </Stat>

      <Stat label="Overall P&L">
        <div
          className={cn(
            "font-display text-2xl font-bold tracking-tight",
            pnlUp ? "text-gain" : "text-loss",
          )}
        >
          {fmt(summary.totalPnl, true)}
        </div>
        <div
          className={cn(
            "flex w-fit items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold",
            pnlUp ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss",
          )}
        >
          {pnlUp ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {pct(summary.totalPnlPct)} all-time
        </div>
      </Stat>

      <Stat label="Today's Change">
        <div
          className={cn(
            "font-display text-2xl font-bold tracking-tight",
            dayUp ? "text-gain" : "text-loss",
          )}
        >
          {fmt(summary.todaysChange, true)}
        </div>
        <div
          className={cn(
            "flex w-fit items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold",
            dayUp ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss",
          )}
        >
          {dayUp ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {pct(summary.todaysChangePct)} today
        </div>
      </Stat>

      <Stat label="Position Count">
        <div className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-fg">
          <Layers className="h-5 w-5 text-fg-muted" />
          {summary.positionCount}{" "}
          <span className="text-sm font-medium text-fg-muted">
            {summary.positionCount === 1 ? "asset" : "assets"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(byExchange).map(([ex, n]) => (
            <span
              key={ex}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] font-bold text-fg-muted"
            >
              {n} {ex}
            </span>
          ))}
        </div>
      </Stat>
    </div>
  );
}
