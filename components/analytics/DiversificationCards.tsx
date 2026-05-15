"use client";

// Diversification metrics (PDR §5.6): unique sectors held, top position
// weight %, and the concentration score (normalized Herfindahl–Hirschman
// Index of position weights, 0 = diversified … 100 = single holding).
// All three come straight from computePortfolio.diversification (PDR §9).
import { Layers, Crown, Gauge } from "lucide-react";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { cn } from "@/lib/utils/cn";

function bandFor(score: number): { label: string; color: string } {
  if (score < 33) return { label: "Well diversified", color: "text-gain" };
  if (score < 66)
    return { label: "Moderately concentrated", color: "text-fg" };
  return { label: "Highly concentrated", color: "text-loss" };
}

function Metric({
  icon,
  label,
  value,
  sub,
  subClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  subClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-high p-5">
      <div className="mb-3 flex items-center gap-2 text-fg-muted">
        {icon}
        <p className="text-[11px] font-bold uppercase tracking-widest">
          {label}
        </p>
      </div>
      <p className="font-display text-3xl font-bold text-fg">{value}</p>
      <p className={cn("mt-1 text-xs font-medium text-fg-muted", subClass)}>
        {sub}
      </p>
    </div>
  );
}

export function DiversificationCards({
  summary,
}: {
  summary: PortfolioSummary;
}) {
  const { uniqueSectors, topWeightPct, concentrationScore } =
    summary.diversification;
  const band = bandFor(concentrationScore);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Metric
        icon={<Layers className="h-4 w-4" />}
        label="Unique Sectors"
        value={String(uniqueSectors)}
        sub={`Across ${summary.positionCount} position${summary.positionCount === 1 ? "" : "s"}`}
      />
      <Metric
        icon={<Crown className="h-4 w-4" />}
        label="Top Position Weight"
        value={`${topWeightPct.toFixed(1)}%`}
        sub="Largest single holding"
      />
      <div className="rounded-md border border-border bg-surface-high p-5">
        <div className="mb-3 flex items-center gap-2 text-fg-muted">
          <Gauge className="h-4 w-4" />
          <p className="text-[11px] font-bold uppercase tracking-widest">
            Concentration Score
          </p>
        </div>
        <p className="font-display text-3xl font-bold text-fg">
          {concentrationScore.toFixed(0)}
          <span className="text-base font-medium text-fg-muted">/100</span>
        </p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-highest">
          <div
            className={cn(
              "h-full rounded-full",
              concentrationScore < 33
                ? "bg-gain"
                : concentrationScore < 66
                  ? "bg-primary"
                  : "bg-loss",
            )}
            style={{
              width: `${Math.max(2, Math.min(100, concentrationScore))}%`,
            }}
          />
        </div>
        <p className={cn("mt-2 text-xs font-medium", band.color)}>
          {band.label}
        </p>
      </div>
    </div>
  );
}
