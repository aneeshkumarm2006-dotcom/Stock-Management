"use client";

// Full holdings table (PDR §5.3). Layout follows the design reference: a
// compact row per position with Ticker · Name · Exchange · Shares · Cost
// basis · Current value · P&L · P&L % · Weight (with inline bar) · row
// actions (kebab menu). Sector, Live price, and Currency are optional
// columns toggleable via the toolbar Columns popover. Cost basis and value
// are display-currency aggregates from computePortfolio; native-currency
// figures appear only when the user opts the Live price column back in
// (PDR §9 — listing currency stays explicit when shown).
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUp, ArrowDown, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { PortfolioRow } from "@/lib/hooks/usePortfolio";
import type { Currency } from "@/lib/utils/convertCurrency";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { TickerLogo } from "@/components/dashboard/TickerLogo";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatNumber, formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils/cn";
import type { OptionalColumn } from "./PortfolioFilters";

type SortKey =
  | "ticker"
  | "quantity"
  | "invested"
  | "price"
  | "currentValue"
  | "pnl"
  | "pnlPct"
  | "weight";

// ISO-2 → flag emoji. Anything outside the table renders no flag rather than
// "undefined" so global listings degrade cleanly.
const FLAG: Record<string, string> = {
  US: "🇺🇸",
  CA: "🇨🇦",
  GB: "🇬🇧",
  DE: "🇩🇪",
  FR: "🇫🇷",
  NL: "🇳🇱",
  BE: "🇧🇪",
  IT: "🇮🇹",
  ES: "🇪🇸",
  PT: "🇵🇹",
  CH: "🇨🇭",
  SE: "🇸🇪",
  NO: "🇳🇴",
  DK: "🇩🇰",
  FI: "🇫🇮",
  IE: "🇮🇪",
  AT: "🇦🇹",
  PL: "🇵🇱",
  TR: "🇹🇷",
  AU: "🇦🇺",
  NZ: "🇳🇿",
  JP: "🇯🇵",
  HK: "🇭🇰",
  SG: "🇸🇬",
  CN: "🇨🇳",
  IN: "🇮🇳",
  KR: "🇰🇷",
  TW: "🇹🇼",
  TH: "🇹🇭",
  MY: "🇲🇾",
  ID: "🇮🇩",
  BR: "🇧🇷",
  MX: "🇲🇽",
  AR: "🇦🇷",
  ZA: "🇿🇦",
  IL: "🇮🇱",
  AE: "🇦🇪",
  SA: "🇸🇦",
};

function valueFor(row: PortfolioRow, key: SortKey): number | string {
  switch (key) {
    case "ticker":
      return row.ticker;
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
    case "weight":
      return row.metrics.weightPct;
  }
}

export function HoldingsTable({
  rows,
  totalRowCount,
  displayCurrency,
  optionalColumns,
  onDelete,
}: {
  rows: PortfolioRow[];
  totalRowCount: number;
  displayCurrency: Currency;
  optionalColumns: Record<OptionalColumn, boolean>;
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

  const maxWeight = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.metrics.weightPct), 0),
    [rows],
  );

  const showSector = optionalColumns.sector;
  const showLivePrice = optionalColumns.livePrice;
  const showCurrency = optionalColumns.currency;

  const baseCols = 9; // ticker, name, exchange, shares, cost basis, value, pnl, pnl%, weight
  const colSpan =
    baseCols +
    (showSector ? 1 : 0) +
    (showLivePrice ? 1 : 0) +
    (showCurrency ? 1 : 0) +
    1; // actions

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
      <Table className="min-w-[960px]">
        <THead>
          <TR className="hover:bg-transparent">
            <SortTH label="Ticker" sortKey="ticker" />
            <TH>Name</TH>
            <TH>Exchange</TH>
            {showSector && <TH>Sector</TH>}
            <SortTH label="Shares" sortKey="quantity" className="text-right" />
            <SortTH
              label="Cost Basis"
              sortKey="invested"
              className="text-right"
            />
            {showLivePrice && (
              <SortTH
                label="Live Price"
                sortKey="price"
                className="text-right"
              />
            )}
            <SortTH
              label="Current Value"
              sortKey="currentValue"
              className="text-right"
            />
            <SortTH label="P&amp;L" sortKey="pnl" className="text-right" />
            <SortTH label="P&amp;L %" sortKey="pnlPct" className="text-right" />
            <SortTH label="Weight" sortKey="weight" className="text-right" />
            {showCurrency && <TH className="text-center">Cur</TH>}
            <TH className="w-10" aria-label="Actions" />
          </TR>
        </THead>
        <TBody>
          {sorted.length === 0 ? (
            <TR className="hover:bg-transparent">
              <TD colSpan={colSpan} className="py-12 text-center text-fg-muted">
                No holdings match the current filters.
              </TD>
            </TR>
          ) : (
            sorted.map((r) => {
              const up = r.metrics.pnl >= 0;
              const weightPct = r.metrics.weightPct;
              const barWidth =
                maxWeight > 0
                  ? Math.max(6, Math.round((weightPct / maxWeight) * 100))
                  : 0;
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
                  <TD className="max-w-[200px] truncate font-medium">
                    {r.name ?? "—"}
                  </TD>
                  <TD>
                    <Badge variant="exchange">{r.exchange}</Badge>
                  </TD>
                  {showSector && (
                    <TD className="text-fg-muted">{r.sector ?? "—"}</TD>
                  )}
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
                  {showLivePrice && (
                    <TD className="text-right font-display text-fg-muted">
                      {r.price == null
                        ? "—"
                        : formatCurrency(r.price, r.nativeCurrency, {
                            format: numberFormat,
                          })}
                    </TD>
                  )}
                  <TD className="text-right font-display font-bold">
                    {formatCurrency(r.metrics.currentValue, displayCurrency, {
                      format: numberFormat,
                    })}
                  </TD>
                  <TD className="text-right">
                    {r.metrics.hasQuote ? (
                      <span
                        className={cn(
                          "font-display text-xs font-bold",
                          up ? "text-gain" : "text-loss",
                        )}
                      >
                        {formatCurrency(r.metrics.pnl, displayCurrency, {
                          format: numberFormat,
                          signed: true,
                        })}
                      </span>
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </TD>
                  <TD className="text-right">
                    {r.metrics.hasQuote ? (
                      <span
                        className={cn(
                          "font-display text-xs font-bold",
                          up ? "text-gain" : "text-loss",
                        )}
                      >
                        {formatPercent(r.metrics.pnlPct, {
                          format: numberFormat,
                          signed: true,
                        })}
                      </span>
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </TD>
                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-low">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            up ? "bg-primary" : "bg-fg-muted/60",
                          )}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className="w-12 text-right font-display text-[11.5px] font-semibold tabular-nums text-fg">
                        {formatPercent(weightPct, {
                          format: numberFormat,
                          signed: false,
                        })}
                      </span>
                    </div>
                  </TD>
                  {showCurrency && (
                    <TD
                      className="text-center"
                      title={`Listed in ${r.nativeCurrency} on ${r.exchange}`}
                    >
                      <span className="inline-flex items-center gap-1 font-display text-[11px] font-bold text-fg">
                        <span aria-hidden>{FLAG[r.country]}</span>
                        {r.nativeCurrency}
                      </span>
                    </TD>
                  )}
                  <TD className="text-right">
                    <Dropdown
                      align="end"
                      trigger={
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-highest hover:text-fg"
                          aria-label={`Actions for ${r.ticker}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </span>
                      }
                    >
                      <DropdownItem onClick={() => openEditPanel(r.id)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit position
                      </DropdownItem>
                      <DropdownItem
                        onClick={() => onDelete(r)}
                        className="hover:text-error"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete position
                      </DropdownItem>
                    </Dropdown>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {sorted.length > 0 && sorted.length !== totalRowCount && (
        <div className="flex items-center justify-between border-t border-border bg-surface/40 px-6 py-3">
          <span className="text-xs text-fg-muted">
            Showing {sorted.length} of {totalRowCount}{" "}
            {totalRowCount === 1 ? "holding" : "holdings"}
          </span>
        </div>
      )}
    </Card>
  );
}
