"use client";

// Top Holdings table (PDR §5.2): logo, ticker, price, qty, value, P&L%,
// weight%. Default sort by current value desc (done in useDashboardData),
// capped at 8 rows. Price shows the position's NATIVE currency (PDR §9 —
// rows stay transparent about the listing currency); value/weight are the
// display-currency aggregates. Rows link to the stock-detail page.
import Link from "next/link";
import type { Holding } from "@/lib/hooks/useDashboard";
import { Card } from "@/components/ui/card";
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
  displayCurrency: "USD" | "CAD";
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const rows = holdings.slice(0, MAX_ROWS);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-5">
        <h3 className="font-display text-sm font-bold uppercase tracking-wider text-fg">
          Top Holdings
        </h3>
        <div className="flex items-center gap-4">
          <span className="hidden text-[10px] font-medium text-fg-muted sm:inline">
            Sorted by value (desc)
          </span>
          <Link
            href="/portfolio"
            className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
          >
            View all
          </Link>
        </div>
      </div>

      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Ticker</TH>
            <TH className="text-right">Price</TH>
            <TH className="text-right">Qty</TH>
            <TH className="text-right">Value</TH>
            <TH className="text-right">P&amp;L %</TH>
            <TH className="text-right">Weight</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((h) => {
            const up = h.metrics.pnlPct >= 0;
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
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-fg group-hover:text-primary">
                        {h.ticker}
                      </div>
                      <div className="truncate text-[10px] text-fg-muted">
                        {(h.name ?? h.ticker)} ({h.exchange})
                      </div>
                    </div>
                  </Link>
                </TD>
                <TD className="text-right font-display">
                  {h.price == null
                    ? "—"
                    : formatCurrency(h.price, h.nativeCurrency, {
                        format: numberFormat,
                      })}
                </TD>
                <TD className="text-right font-medium">
                  {formatNumber(h.metrics.quantity, {
                    format: numberFormat,
                    decimals: 0,
                  })}
                </TD>
                <TD className="text-right font-display font-bold">
                  {formatCurrency(h.metrics.currentValue, displayCurrency, {
                    format: numberFormat,
                  })}
                </TD>
                <TD
                  className={cn(
                    "text-right text-[11px] font-bold",
                    up ? "text-gain" : "text-loss",
                  )}
                >
                  {h.metrics.hasQuote
                    ? formatPercent(h.metrics.pnlPct, {
                        format: numberFormat,
                      })
                    : "—"}
                </TD>
                <TD className="text-right">
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
