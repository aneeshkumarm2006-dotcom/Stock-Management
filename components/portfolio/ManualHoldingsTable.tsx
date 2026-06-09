"use client";

// Manually-valued section — Mutual funds and Cash/Other. The fund variant
// shows cost, current value, P&L and a "value as-of" cell with a red staleness
// dot (value not refreshed this calendar month) plus an "Update value" action.
// The cash variant is leaner: just a single value, no P&L, no staleness.
import { MoreHorizontal, Pencil, Trash2, RefreshCw } from "lucide-react";
import type { PortfolioRow } from "@/lib/hooks/usePortfolio";
import type { Currency } from "@/lib/utils/convertCurrency";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { isManualValueStale } from "@/lib/utils/assetValuation";
import { toDateInputValue as fmtDate } from "@/lib/utils/dateInput";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils/cn";

export function ManualHoldingsTable({
  rows,
  displayCurrency,
  variant,
  onDelete,
  onUpdateValue,
}: {
  rows: PortfolioRow[];
  displayCurrency: Currency;
  variant: "MUTUAL_FUND" | "CASH";
  onDelete: (row: PortfolioRow) => void;
  onUpdateValue?: (row: PortfolioRow) => void;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const openEditPanel = useUiStore((s) => s.openEditPanel);
  const isFund = variant === "MUTUAL_FUND";

  return (
    <Card className="overflow-hidden">
      <Table className="min-w-[900px]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Name</TH>
            <TH>Held By</TH>
            <TH className="text-center">Cur</TH>
            {isFund && <TH className="text-right">Cost</TH>}
            <TH className="text-right">
              {isFund ? "Current Value" : "Value"}
            </TH>
            {isFund && <TH className="text-right">P&amp;L</TH>}
            {isFund && <TH>Value As-Of</TH>}
            <TH className="w-10" aria-label="Actions" />
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            const up = r.metrics.pnl >= 0;
            const stale = isFund && isManualValueStale(r.valueAsOf);
            return (
              <TR key={r.id} className="group">
                <TD className="max-w-[220px] truncate font-medium">
                  {r.label ?? "—"}
                </TD>
                <TD className="max-w-[160px] truncate text-fg-muted">
                  {r.companyName ?? "—"}
                </TD>
                <TD className="text-center font-display text-[11px] font-bold text-fg">
                  {r.nativeCurrency}
                </TD>
                {isFund && (
                  <TD className="text-right font-display text-fg-muted">
                    {r.costBasis == null
                      ? "—"
                      : formatCurrency(r.costBasis, r.nativeCurrency, {
                          format: numberFormat,
                        })}
                  </TD>
                )}
                <TD className="text-right font-display font-bold">
                  {formatCurrency(r.metrics.currentValue, displayCurrency, {
                    format: numberFormat,
                  })}
                </TD>
                {isFund && (
                  <TD className="text-right">
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
                  </TD>
                )}
                {isFund && (
                  <TD>
                    <span className="flex items-center gap-1.5 text-fg-muted">
                      {stale && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-error"
                          title="Not updated this month — please refresh the value"
                          aria-label="Value not updated this month"
                        />
                      )}
                      {r.valueAsOf ? fmtDate(r.valueAsOf) : "—"}
                    </span>
                  </TD>
                )}
                <TD className="text-right">
                  <Dropdown
                    align="end"
                    trigger={
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-highest hover:text-fg"
                        aria-label={`Actions for ${r.label}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    }
                  >
                    {isFund && onUpdateValue && (
                      <DropdownItem onClick={() => onUpdateValue(r)}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Update value
                      </DropdownItem>
                    )}
                    <DropdownItem onClick={() => openEditPanel(r.id)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit holding
                    </DropdownItem>
                    <DropdownItem
                      onClick={() => onDelete(r)}
                      className="hover:text-error"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete holding
                    </DropdownItem>
                  </Dropdown>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}
