"use client";

// Allocation donut (Recharts) with a By Stock / Sector / Country switcher
// (PDR §5.2). Slices come from computePortfolio's currency-converted
// allocation buckets; the long tail is folded into an "Others" slice to
// keep the legend readable, matching site/design/dashboard.
import * as React from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { PortfolioSummary, AllocationSlice } from "@/lib/utils/portfolioMath";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useChartTheme } from "@/components/analytics/chartTheme";
import { cn } from "@/lib/utils/cn";

type Dim = "stock" | "sector" | "country";

const DIMS: { id: Dim; label: string }[] = [
  { id: "stock", label: "Stock" },
  { id: "sector", label: "Sector" },
  { id: "country", label: "Country" },
];

const MAX_SLICES = 6;

const COUNTRY_LABEL: Record<string, string> = { US: "United States", CA: "Canada" };

function foldTail(slices: AllocationSlice[]): AllocationSlice[] {
  if (slices.length <= MAX_SLICES) return slices;
  const head = slices.slice(0, MAX_SLICES - 1);
  const tail = slices.slice(MAX_SLICES - 1);
  const others = tail.reduce(
    (acc, s) => ({
      key: "Others",
      value: acc.value + s.value,
      pct: acc.pct + s.pct,
    }),
    { key: "Others", value: 0, pct: 0 },
  );
  return [...head, others];
}

export function AllocationCard({ summary }: { summary: PortfolioSummary }) {
  const [dim, setDim] = React.useState<Dim>("stock");
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const t = useChartTheme();

  const slices = React.useMemo(() => {
    const source =
      dim === "stock"
        ? summary.allocationByStock
        : dim === "sector"
          ? summary.allocationBySector
          : summary.allocationByCountry;
    return foldTail(source.filter((s) => s.value > 0));
  }, [dim, summary]);

  const cur = summary.displayCurrency;
  // Skip the gain/loss/neutral tail of the chart palette so the donut keeps the
  // brand-forward look (no red slice for a healthy position).
  const slicePalette = t.palette.slice(0, 6);
  const colorFor = (key: string, i: number) =>
    key === "Others"
      ? t.othersColor
      : (slicePalette[i % slicePalette.length] ?? t.othersColor);
  const labelFor = (key: string) =>
    dim === "country" ? (COUNTRY_LABEL[key] ?? key) : key;

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border p-5">
        <h3 className="font-display text-sm font-bold uppercase tracking-wider text-fg">
          Asset Allocation
        </h3>
        <div className="flex rounded border border-border bg-surface-low p-0.5">
          {DIMS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDim(d.id)}
              aria-pressed={dim === d.id}
              className={cn(
                "rounded px-3 py-1 text-[10px] font-bold transition-colors",
                dim === d.id
                  ? "bg-surface-highest text-fg"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col items-center justify-center">
        {slices.length === 0 ? (
          <p className="py-12 text-xs text-fg-muted">
            No allocation data yet.
          </p>
        ) : (
          <>
            <div className="relative h-56 w-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="key"
                    innerRadius="72%"
                    outerRadius="100%"
                    paddingAngle={1.5}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {slices.map((s, i) => (
                      <Cell key={s.key} fill={colorFor(s.key, i)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={t.tooltipContent}
                    itemStyle={t.tooltipItem}
                    formatter={(value: number, name: string) => [
                      formatCurrency(value, cur, { format: numberFormat }),
                      labelFor(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold uppercase text-fg-muted">
                  Holdings
                </span>
                <span className="font-display text-2xl font-bold text-fg">
                  {summary.positionCount}
                </span>
              </div>
            </div>

            <div className="mt-8 w-full space-y-3">
              {slices.map((s, i) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: colorFor(s.key, i) }}
                    />
                    <span
                      className={cn(
                        "text-xs font-bold",
                        s.key === "Others" && "text-fg-muted",
                      )}
                    >
                      {labelFor(s.key)}
                    </span>
                  </div>
                  <span className="font-display text-xs font-medium text-fg-muted">
                    {s.pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
