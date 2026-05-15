"use client";

// Invested vs current value — grouped bar, one pair per position (PDR §5.6).
// Both figures are in the display currency (computePortfolio — PDR §9).
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  AXIS_TICK,
  GRID_STROKE,
} from "./chartTheme";

const INVESTED_COLOR = "#A2ABC5";
const VALUE_COLOR = "#3B82F6";

export function InvestedVsValue({
  summary,
}: {
  summary: PortfolioSummary;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const cur = summary.displayCurrency;

  const data = summary.positions
    .map((p) => ({
      ticker: p.ticker,
      Invested: p.invested,
      Value: p.currentValue,
    }))
    .sort((a, b) => b.Value - a.Value);

  const money = (v: number) =>
    formatCurrency(v, cur, { format: numberFormat, compact: true });

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Invested vs Current Value</CardTitle>
        <span className="text-[11px] font-medium text-fg-muted">
          {cur}
        </span>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-12 text-center text-xs text-fg-muted">
            No positions yet.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={data}
              margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
              barGap={2}
              barCategoryGap="20%"
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={GRID_STROKE}
                vertical={false}
              />
              <XAxis
                dataKey="ticker"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                interval={0}
                angle={data.length > 8 ? -35 : 0}
                textAnchor={data.length > 8 ? "end" : "middle"}
                height={data.length > 8 ? 50 : 24}
              />
              <YAxis
                tickFormatter={(v: number) => money(v)}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <Tooltip
                cursor={{ fill: "#ffffff08" }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(value: number, name: string) => [
                  money(value),
                  name,
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "#A2ABC5" }}
                iconType="circle"
              />
              <Bar
                dataKey="Invested"
                fill={INVESTED_COLOR}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="Value"
                fill={VALUE_COLOR}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
