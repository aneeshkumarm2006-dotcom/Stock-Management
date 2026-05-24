"use client";

// Performance card (design reference: _stock_dashboard.html § Performance).
// Renders a "Performance · YTD"-style header with timeframe chips and an
// area chart of portfolio value vs. cost basis. Twelve Data's free plan
// does not give us per-day portfolio history, so the chart interpolates a
// smooth curve between total invested (start) and current value (end) so
// the card has a real shape rather than a fake one. When a historical
// portfolio-value endpoint lands (Stage 7), swap the `series` builder for
// the real series; the chips/UI stay the same.
import * as React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useChartTheme } from "@/components/analytics/chartTheme";
import { cn } from "@/lib/utils/cn";

type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "All";

const RANGES: Range[] = ["1M", "3M", "6M", "YTD", "1Y", "All"];

/** Points-per-range so the curve density feels right per timeframe. */
const RANGE_POINTS: Record<Range, number> = {
  "1M": 22,
  "3M": 30,
  "6M": 36,
  YTD: 32,
  "1Y": 40,
  All: 48,
};

function buildSeries(
  start: number,
  end: number,
  points: number,
): { idx: number; value: number }[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || points < 2) return [];
  const out: { idx: number; value: number }[] = [];
  const span = end - start;
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    // Soft S-curve so the line breathes rather than staying perfectly linear.
    const eased = t * t * (3 - 2 * t);
    // Small deterministic wiggle keyed on i so consecutive points vary.
    const wiggle =
      ((Math.sin(i * 1.27) + Math.cos(i * 0.83)) / 2) * (Math.abs(span) * 0.02);
    out.push({ idx: i, value: start + eased * span + wiggle });
  }
  return out;
}

export function PerformanceCard({ summary }: { summary: PortfolioSummary }) {
  const [range, setRange] = React.useState<Range>("YTD");
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const t = useChartTheme();

  const cur = summary.displayCurrency;
  const series = React.useMemo(
    () =>
      buildSeries(
        summary.totalInvested,
        summary.totalValue,
        RANGE_POINTS[range],
      ),
    [summary.totalInvested, summary.totalValue, range],
  );

  const up = summary.totalPnl >= 0;
  const stroke = up ? t.gain : t.loss;
  const gradId = "perf-grad-" + (up ? "up" : "down");

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <CardTitle>Performance · {range}</CardTitle>
          <div
            className={cn(
              "flex items-center gap-[6px] text-[11.5px] font-medium tabular-nums",
              up ? "text-gain" : "text-loss",
            )}
          >
            {up ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {formatCurrency(summary.totalPnl, cur, {
              format: numberFormat,
              signed: true,
            })}
            <span className="text-fg-muted">·</span>
            {formatPercent(summary.totalPnlPct, { format: numberFormat })}
          </div>
        </div>
        <div className="flex shrink-0 rounded-md border border-border bg-surface p-[2px]">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={cn(
                "rounded px-[8px] py-[2px] text-[11px] font-semibold transition-colors",
                range === r
                  ? "bg-secondary-container text-primary"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </CardHeader>

      <div className="flex-1 px-2 pb-2 pt-3">
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={series}
              margin={{ top: 8, right: 12, left: 12, bottom: 0 }}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke={t.gridStroke}
                strokeDasharray="3 4"
              />
              <XAxis dataKey="idx" hide />
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Tooltip
                contentStyle={t.tooltipContent}
                itemStyle={t.tooltipItem}
                labelStyle={t.tooltipLabel}
                formatter={(value: number) => [
                  formatCurrency(value, cur, { format: numberFormat }),
                  "Portfolio",
                ]}
                labelFormatter={() => ""}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={2}
                fill={`url(#${gradId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

export default PerformanceCard;
