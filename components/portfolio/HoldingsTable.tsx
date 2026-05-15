"use client";

// Full holdings table (PDR §5.3): logo+ticker, name, exchange badge, sector,
// avg buy, qty, invested, live price, current value, unrealized P&L ($ & %),
// native-currency flag, row actions (edit/delete). Any numeric column is
// sortable. Price + avg buy are shown in the row's NATIVE currency (PDR §9 —
// rows stay transparent about the listing currency); invested / value / P&L
// are the display-currency aggregates from computePortfolio.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUp, ArrowDown, Pencil, Trash2 } from "lucide-react";
import type { PortfolioRow } from "@/lib/hooks/usePortfolio";
import type { Currency } from "@/lib/utils/convertCurrency";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TickerLogo } from "@/components/dashboard/TickerLogo";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatNumber, formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils/cn";

type SortKey =
  | "ticker"
  | "avgBuyPrice"
  | "quantity"
  | "invested"
  | "price"
  | "currentValue"
  | "pnl"
  | "pnlPct";

const FLAG: Record<"US" | "CA", string> = { US: "🇺🇸", CA: "🇨🇦" };

function valueFor(row: PortfolioRow, key: SortKey): number | string {
  switch (key) {
    case "ticker":
      return row.ticker;
    case "avgBuyPrice":
      return row.avgBuyPrice;
    case "quantity":
      return row.quantity;
    case "invested":
      return row.metrics.invested;
    case "price":
      return row.price ?? -Infinity;
    case "currentValue":
      return row.metrics.currentValue;
    case "pnl":
      return row.metrics.pnl;
    case "pnlPct":
      return row.metrics.pnlPct;
  }
}

export function HoldingsTable({
  rows,
  totalRowCount,
  displayCurrency,
  onDelete,
}: {
  rows: PortfolioRow[];
  totalRowCount: number;
  displayCurrency: Currency;
  onDelete: (row: PortfolioRow) => void;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const openEditPanel = useUiStore((s) => s.openEditPanel);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "currentValue",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      const av = valueFor(a, sort.key);
      const bv = valueFor(b, sort.key);
      let cmp: number;
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv);
      } else {
        cmp = (av as number) - (bv as number);
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "ticker" ? "asc" : "desc" },
    );
  }

  const exchanges = new Set(rows.map((r) => r.exchange)).size;

  function SortTH({
    label,
    sortKey,
    className,
  }: {
    label: string;
    sortKey: SortKey;
    className?: string;
  }) {
    const active = sort.key === sortKey;
    return (
      <TH className={className}>
        <button
          type="button"
          onClick={() => toggleSort(sortKey)}
          className={cn(
            "inline-flex items-center gap-1 uppercase tracking-widest transition-colors hover:text-fg",
            active && "text-fg",
          )}
        >
          {label}
          {active &&
            (sort.dir === "asc" ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            ))}
        </button>
      </TH>
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table className="min-w-[1100px]">
        <THead>
          <TR className="hover:bg-transparent">
            <SortTH label="Ticker" sortKey="ticker" />
            <TH>Name</TH>
            <TH className="text-center">Exch</TH>
            <TH>Sector</TH>
            <SortTH label="Avg Buy" sortKey="avgBuyPrice" className="text-right" />
            <SortTH label="Qty" sortKey="quantity" className="text-right" />
            <SortTH label="Invested" sortKey="invested" className="text-right" />
            <SortTH label="Live Price" sortKey="price" className="text-right" />
            <SortTH label="Value" sortKey="currentValue" className="text-right" />
            <SortTH label="Unrealized P&amp;L" sortKey="pnl" className="text-right" />
            <TH className="text-center">Cur</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {sorted.length === 0 ? (
            <TR className="hover:bg-transparent">
              <TD colSpan={12} className="py-12 text-center text-fg-muted">
                No holdings match the current filters.
              </TD>
            </TR>
          ) : (
            sorted.map((r) => {
              const up = r.metrics.pnl >= 0;
              return (
                <TR key={r.id} className="group">
                  <TD>
                    <Link
                      href={`/stock/${r.exchange}/${encodeURIComponent(r.ticker)}`}
                      className="flex items-center gap-3"
                    >
                      <TickerLogo
                        ticker={r.ticker}
                        name={r.name}
                        logo={r.logo}
                      />
                      <span className="font-bold text-primary group-hover:underline">
                        {r.ticker}
                      </span>
                    </Link>
                  </TD>
                  <TD className="max-w-[180px] truncate font-medium">
                    {r.name ?? "—"}
                  </TD>
                  <TD className="text-center">
                    <Badge variant="exchange">{r.exchange}</Badge>
                  </TD>
                  <TD className="text-fg-muted">{r.sector ?? "—"}</TD>
                  <TD className="text-right font-display">
                    {formatCurrency(r.avgBuyPrice, r.nativeCurrency, {
                      format: numberFormat,
                    })}
                  </TD>
                  <TD className="text-right font-display">
                    {formatNumber(r.quantity, {
                      format: numberFormat,
                      decimals: 0,
                    })}
                  </TD>
                  <TD className="text-right font-display">
                    {formatCurrency(r.metrics.invested, displayCurrency, {
                      format: numberFormat,
                    })}
                  </TD>
                  <TD className="text-right font-display">
                    {r.price == null
                      ? "—"
                      : formatCurrency(r.price, r.nativeCurrency, {
                          format: numberFormat,
                        })}
                  </TD>
                  <TD className="text-right font-display font-bold">
                    {formatCurrency(r.metrics.currentValue, displayCurrency, {
                      format: numberFormat,
                    })}
                  </TD>
                  <TD className="text-right">
                    {r.metrics.hasQuote ? (
                      <>
                        <div
                          className={cn(
                            "text-xs font-bold",
                            up ? "text-gain" : "text-loss",
                          )}
                        >
                          {formatCurrency(r.metrics.pnl, displayCurrency, {
                            format: numberFormat,
                            signed: true,
                          })}
                        </div>
                        <div
                          className={cn(
                            "text-[10px]",
                            up ? "text-gain/80" : "text-loss/80",
                          )}
                        >
                          {formatPercent(r.metrics.pnlPct, {
                            format: numberFormat,
                          })}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </TD>
                  {/* Native listing currency — authoritative and shown
                      explicitly so the TSX-listed-USD edge (country CA but
                      held in USD) stays transparent (PDR §9). The country
                      flag is a secondary cue only. */}
                  <TD
                    className="text-center"
                    title={`Listed in ${r.nativeCurrency} on ${r.exchange}`}
                  >
                    <span className="inline-flex items-center gap-1 font-display text-[11px] font-bold text-fg">
                      <span aria-hidden>{FLAG[r.country]}</span>
                      {r.nativeCurrency}
                    </span>
                  </TD>
                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        aria-label={`Edit ${r.ticker}`}
                        onClick={() => openEditPanel(r.id)}
                        className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface-highest hover:text-primary"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${r.ticker}`}
                        onClick={() => onDelete(r)}
                        className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface-highest hover:text-error"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      <div className="flex items-center justify-between border-t border-border bg-surface/40 px-6 py-4">
        <span className="text-xs text-fg-muted">
          Showing {sorted.length} of {totalRowCount}{" "}
          {totalRowCount === 1 ? "holding" : "holdings"}
          {exchanges > 0 &&
            ` across ${exchanges} ${exchanges === 1 ? "exchange" : "exchanges"}`}
        </span>
      </div>
    </Card>
  );
}
