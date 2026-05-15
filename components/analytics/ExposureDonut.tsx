"use client";

// Reusable exposure donut — drives both the Country (US vs CA) and Currency
// (USD vs CAD) charts on the Analytics page (PDR §5.6). Values are the
// currency-converted buckets from computePortfolio (PDR §9). Currency
// exposure can legitimately differ from country exposure for TSX-listed
// US companies held in CAD, so the two are shown side by side.
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { AllocationSlice } from "@/lib/utils/portfolioMath";
import type { Currency } from "@/lib/utils/convertCurrency";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  PALETTE,
} from "./chartTheme";

export function ExposureDonut({
  title,
  slices,
  labelMap,
  displayCurrency,
}: {
  title: string;
  slices: AllocationSlice[];
  labelMap: Record<string, string>;
  displayCurrency: Currency;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const data = slices.filter((s) => s.value > 0);
  const labelFor = (key: string) => labelMap[key] ?? key;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-center">
        {data.length === 0 ? (
          <p className="py-12 text-xs text-fg-muted">No data yet.</p>
        ) : (
          <>
            <div className="h-48 w-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="key"
                    innerRadius="62%"
                    outerRadius="100%"
                    paddingAngle={1.5}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {data.map((s, i) => (
                      <Cell
                        key={s.key}
                        fill={PALETTE[i % PALETTE.length] ?? PALETTE[0]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(value: number, name: string) => [
                      formatCurrency(value, displayCurrency, {
                        format: numberFormat,
                        compact: true,
                      }),
                      labelFor(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-6 w-full space-y-3">
              {data.map((s, i) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: PALETTE[i % PALETTE.length] ?? PALETTE[0],
                      }}
                    />
                    <span className="text-xs font-bold text-fg">
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
