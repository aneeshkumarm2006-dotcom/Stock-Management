"use client";

// Top Holdings table (PDR §5.2). Columns mirror the design reference:
//   Ticker / Name / Exchange / Shares / Price / P&L / Weight
// — name and exchange get their own columns rather than being stacked under
// the ticker, so the table reads as a true holdings list rather than a
// repeated ticker block.
//
// Default sort by current value desc (done in useDashboardData), capped at
// 8 rows. Price stays in the position's NATIVE currency (PDR §9 — rows are
// transparent about the listing currency); value/weight are the
// display-currency aggregates. Rows link to the stock-detail page.
import Link from "next/link";
import type { Holding } from "@/lib/hooks/useDashboard";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { TickerLogo } from "@/components/dashboard/TickerLogo";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatNumber, formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cn } from "@/lib/utils/cn";

const MAX_ROWS = 8;

export function TopHoldings({
  holdings,
  displayCurrency,
}: {
  holdings: Holding[];
  displayCurrency: string;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const rows = holdings.slice(0, MAX_ROWS);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top holdings</CardTitle>
        <Link
          href="/stock/portfolio"
          className="text-[11.5px] font-semibold text-primary hover:underline"
        >
          View all →
        </Link>
      </CardHeader>

      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Ticker</TH>
            <TH>Name</TH>
            <TH className="text-center">Exchange</TH>
            <TH className="text-right">Shares</TH>
            <TH className="text-right">Price</TH>
            <TH className="text-right">P&amp;L</TH>
            <TH className="text-right">Weight</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((h) => {
            const up = h.metrics.pnl >= 0;
            return (
              <TR key={h.id} className="group">
                <TD>
                  <Link
                    href={`/stock/${h.exchange}/${encodeURIComponent(h.ticker)}`}
                    className="flex items-center gap-3"
                  >
                    <TickerLogo
                      ticker={h.ticker}
                      name={h.name}
                      logo={h.logo}
                    />
                    <span className="font-mono text-[12.5px] font-semibold tracking-tight text-fg group-hover:text-primary">
                      {h.ticker}
                    </span>
                  </Link>
                </TD>
                <TD className="max-w-[200px] truncate text-fg">
                  {h.name ?? "—"}
                </TD>
                <TD className="text-center">
                  <Badge variant="exchange">{h.exchange}</Badge>
                </TD>
                <TD className="text-right tabular-nums">
                  {formatNumber(h.metrics.quantity, {
                    format: numberFormat,
                    decimals: 0,
                  })}
                </TD>
                <TD className="text-right tabular-nums">
                  {h.price == null
                    ? "—"
                    : formatCurrency(h.price, h.nativeCurrency, {
                        format: numberFormat,
                      })}
                </TD>
                <TD className="text-right">
                  {h.metrics.hasQuote ? (
                    <div
                      className={cn(
                        "font-semibold tabular-nums",
                        up ? "text-gain" : "text-loss",
                      )}
                    >
                      <div className="text-[12.5px]">
                        {formatCurrency(h.metrics.pnl, displayCurrency, {
                          format: numberFormat,
                          signed: true,
                          compact: true,
                        })}
                      </div>
                      <div className="text-[10.5px] opacity-80">
                        {formatPercent(h.metrics.pnlPct, {
                          format: numberFormat,
                        })}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-fg-muted">—</span>
                  )}
                </TD>
                <TD className="text-right tabular-nums text-fg-muted">
                  {h.metrics.weightPct.toFixed(1)}%
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}
