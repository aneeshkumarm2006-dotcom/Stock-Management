"use client";

// Analytics top strip (PDR §5.6). Layout follows the design reference:
//   1. Diversification score — Herfindahl-derived 0-100 with a progress bar
//      and a qualitative band (Well diversified / Moderately concentrated /
//      Highly concentrated).
//   2. Invested — total cost basis, display currency.
//   3. Value — current market value, with the total-return % as a subtitle
//      so the gain/loss reads alongside the headline figure.
// Every monetary figure is the display-currency aggregate from
// computePortfolio (PDR §9). Concentration score uses normalized HHI of
// position weights, so 0 = perfectly diversified, 100 = single holding.
import { Gauge } from "lucide-react";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cn } from "@/lib/utils/cn";

function bandFor(score: number): { label: string; color: string } {
  if (score < 33) return { label: "Well diversified", color: "text-gain" };
  if (score < 66)
    return { label: "Moderately concentrated", color: "text-fg" };
  return { label: "Highly concentrated", color: "text-loss" };
}

function MoneyCard({
  label,
  value,
  sub,
  subClass,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-high p-5">
      <p className="text-[11px] font-bold uppercase tracking-widest text-fg-muted">
        {label}
      </p>
      <p className="mt-3 font-display text-3xl font-bold text-fg tabular-nums">
        {value}
      </p>
      {sub && (
        <p className={cn("mt-1 text-xs font-medium text-fg-muted", subClass)}>
          {sub}
        </p>
      )}
    </div>
  );
}

export function DiversificationCards({
  summary,
}: {
  summary: PortfolioSummary;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const cur = summary.displayCurrency;
  const money = (v: number) =>
    formatCurrency(v, cur, { format: numberFormat });
  const pct = (v: number) => formatPercent(v, { format: numberFormat });

  // The reference shows a "score" that reads as good when high. Our internal
  // concentrationScore is the inverse (HHI: 0 = diversified, 100 = single
  // holding), so flip it for the display so the band reads naturally.
  const concentration = summary.diversification.concentrationScore;
  const diversificationScore = Math.round(100 - concentration);
  const band = bandFor(concentration);

  const pnlUp = summary.totalPnl >= 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Diversification score */}
      <div className="rounded-md border border-border bg-surface-high p-5">
        <div className="flex items-center justify-between gap-2 text-fg-muted">
          <p className="text-[11px] font-bold uppercase tracking-widest">
            Diversification score
          </p>
          <Gauge className="h-4 w-4" />
        </div>
        <p className="mt-3 font-display text-3xl font-bold text-fg tabular-nums">
          {diversificationScore}
          <span className="text-base font-medium text-fg-muted"> / 100</span>
        </p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-highest">
          <div
            className={cn(
              "h-full rounded-full",
              concentration < 33
                ? "bg-gain"
                : concentration < 66
                  ? "bg-primary"
                  : "bg-loss",
            )}
            style={{
              width: `${Math.max(2, Math.min(100, diversificationScore))}%`,
            }}
          />
        </div>
        <p className={cn("mt-2 text-xs font-medium", band.color)}>
          {band.label}
        </p>
      </div>

      <MoneyCard label="Invested" value={money(summary.totalInvested)} />

      <MoneyCard
        label="Value"
        value={money(summary.totalValue)}
        sub={`${pct(summary.totalPnlPct)} total return`}
        subClass={pnlUp ? "text-gain" : "text-loss"}
      />
    </div>
  );
}
