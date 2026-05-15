"use client";

// P&L ranking — horizontal bar of every position ordered by P&L %, green for
// positive, red for negative (PDR §5.6). P&L is computed in the display
// currency by computePortfolio (PDR §9). A diverging X axis (bars grow left
// for losses, right for gains) reads as a ranking at a glance.
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { PortfolioSummary } from "@/lib/utils/portfolioMath";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  AXIS_TICK,
  GAIN,
  LOSS,
} from "./chartTheme";

export function PnlRanking({ summary }: { summary: PortfolioSummary }) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const cur = summary.displayCurrency;

  const data = summary.positions
    .map((p) => ({
      ticker: p.ticker,
      pnlPct: p.pnlPct,
      pnl: p.pnl,
    }))
    .sort((a, b) => b.pnlPct - a.pnlPct);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>P&amp;L Ranking</CardTitle>
        <span className="text-[11px] font-medium text-fg-muted">
          By return %
        </span>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-12 text-center text-xs text-fg-muted">
            No positions yet.
          </p>
        ) : (
          <ResponsiveContainer
            width="100%"
            height={Math.max(160, data.length * 40)}
          >
            <BarChart
              layout="vertical"
              data={data}
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
              barCategoryGap={8}
            >
              <XAxis
                type="number"
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="ticker"
                width={72}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine x={0} stroke="#3F485E" />
              <Tooltip
                cursor={{ fill: "#ffffff08" }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(
                  _v: number,
                  _n: string,
                  item: { payload?: { pnlPct: number; pnl: number } },
                ) => [
                  `${formatPercent(item.payload?.pnlPct ?? 0, {
                    format: numberFormat,
                  })} · ${formatCurrency(item.payload?.pnl ?? 0, cur, {
                    format: numberFormat,
                    signed: true,
                    compact: true,
                  })}`,
                  "Unrealized P&L",
                ]}
              />
              <Bar dataKey="pnlPct" radius={2} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell
                    key={d.ticker}
                    fill={d.pnlPct >= 0 ? GAIN : LOSS}
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
