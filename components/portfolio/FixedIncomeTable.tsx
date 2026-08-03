"use client";

// Fixed-income section (GIC + Bond). Columns suit held-to-maturity holdings:
// principal, rate, payout cadence, start/maturity dates, the auto-calculated
// maturity value and the accrued (current) value. Every money column renders in
// the DISPLAY currency so the row is internally consistent when the USD/CAD
// toggle flips; the "Cur" column keeps the holding's native currency visible.
// No live price / P&L% — these are valued by formula, not a market quote.
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { PortfolioRow } from "@/lib/hooks/usePortfolio";
import type { Currency } from "@/lib/utils/convertCurrency";
import type { PayoutFrequency } from "@/lib/hooks/useDashboard";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatNumber } from "@/lib/utils/formatNumber";
import { toDateInputValue } from "@/lib/utils/dateInput";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useUiStore } from "@/store/useUiStore";

const PAYOUT_LABEL: Record<PayoutFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMI_ANNUAL: "Semi-annual",
  ANNUAL: "Annual",
  AT_MATURITY: "At maturity",
};

export function FixedIncomeTable({
  rows,
  displayCurrency,
  onDelete,
}: {
  rows: PortfolioRow[];
  displayCurrency: Currency;
  onDelete: (row: PortfolioRow) => void;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const openEditPanel = useUiStore((s) => s.openEditPanel);

  return (
    <Card className="overflow-hidden">
      <Table className="min-w-[1100px]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Name</TH>
            <TH>Institution</TH>
            <TH>Held By</TH>
            <TH>Broker</TH>
            <TH className="text-center">Cur</TH>
            <TH className="text-right">Principal</TH>
            <TH className="text-right">Rate</TH>
            <TH>Payout</TH>
            <TH>Maturity</TH>
            <TH className="text-right">Maturity Value</TH>
            <TH className="text-right">Current Value</TH>
            <TH className="w-10" aria-label="Actions" />
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            // A non-finite principal collapses to 0 inside valuateHolding, which
            // would render a misleading $0.00 for both Principal and Maturity
            // Value. Gate them together on the native field so the em-dash wins.
            const hasPrincipal =
              r.principal != null && Number.isFinite(r.principal);
            return (
              <TR key={r.id} className="group">
                <TD className="max-w-[200px] truncate font-medium">
                  <span className="flex items-center gap-2">
                    <Badge variant={r.assetType === "BOND" ? "purple" : "blue"}>
                      {r.assetType === "BOND" ? "Bond" : "GIC"}
                    </Badge>
                    {r.label ?? "—"}
                  </span>
                </TD>
                <TD className="max-w-[160px] truncate text-fg-muted">
                  {r.institution ?? "—"}
                </TD>
                <TD className="max-w-[160px] truncate text-fg-muted">
                  {r.companyName ?? "—"}
                </TD>
                <TD className="max-w-[160px] truncate text-fg-muted">
                  {r.brokerName ?? "—"}
                </TD>
                <TD
                  className="text-center font-display text-[11px] font-bold text-fg"
                  title={`Held in ${r.nativeCurrency} — amounts shown in ${displayCurrency}`}
                >
                  {r.nativeCurrency}
                </TD>
                {/* Non-equity holdings enter portfolioMath with quantity 1 and
                  avgBuyPrice = principal, so metrics.invested IS the principal
                  already converted into the display currency. */}
                <TD className="text-right font-display">
                  {hasPrincipal
                    ? formatCurrency(r.metrics.invested, displayCurrency, {
                        format: numberFormat,
                      })
                    : "—"}
                </TD>
                <TD className="text-right font-display text-fg-muted">
                  {r.interestRate == null
                    ? "—"
                    : `${formatNumber(r.interestRate, { format: numberFormat })}%`}
                </TD>
                <TD className="text-fg-muted">
                  {r.payoutFrequency ? PAYOUT_LABEL[r.payoutFrequency] : "—"}
                </TD>
                <TD className="text-fg-muted">
                  {r.maturityDate ? toDateInputValue(r.maturityDate) : "—"}
                </TD>
                <TD className="text-right font-display text-fg-muted">
                  {hasPrincipal && r.maturityValueDisplay != null
                    ? formatCurrency(r.maturityValueDisplay, displayCurrency, {
                        format: numberFormat,
                      })
                    : "—"}
                </TD>
                <TD className="text-right font-display font-bold">
                  {formatCurrency(r.metrics.currentValue, displayCurrency, {
                    format: numberFormat,
                  })}
                </TD>
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
