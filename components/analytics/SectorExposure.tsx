"use client";

// Sector exposure — horizontal bar chart, % of portfolio per sector
// (PDR §5.6). Slices are the currency-converted sector buckets from
// computePortfolio (PDR §9), already sorted by value desc.
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useChartTheme } from "./chartTheme";

export function SectorExposure({ summary }: { summary: PortfolioSummary }) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const cur = summary.displayCurrency;
  const data = summary.allocationBySector.filter((s) => s.value > 0);
  const t = useChartTheme();

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Sector Exposure</CardTitle>
        <span className="text-[11px] font-medium text-fg-muted">
          {data.length} sector{data.length === 1 ? "" : "s"}
        </span>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-12 text-center text-xs text-fg-muted">
            No sector data yet.
          </p>
        ) : (
          <ResponsiveContainer
            width="100%"
            height={Math.max(160, data.length * 44)}
          >
            <BarChart
              layout="vertical"
              data={data}
              margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
              barCategoryGap={10}
            >
              <XAxis
                type="number"
                domain={[0, "dataMax"]}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                tick={t.axisTick}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="key"
                width={120}
                tick={t.axisTick}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: t.cursorFill }}
                contentStyle={t.tooltipContent}
                itemStyle={t.tooltipItem}
                labelStyle={t.tooltipLabel}
                formatter={(_v: number, _n: string, item: { payload?: { pct: number; value: number } }) => [
                  `${(item.payload?.pct ?? 0).toFixed(1)}% · ${formatCurrency(
                    item.payload?.value ?? 0,
                    cur,
                    { format: numberFormat, compact: true },
                  )}`,
                  "Allocation",
                ]}
              />
              <Bar dataKey="pct" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {data.map((s, i) => (
                  <Cell
                    key={s.key}
                    fill={t.palette[i % t.palette.length] ?? t.palette[0]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
