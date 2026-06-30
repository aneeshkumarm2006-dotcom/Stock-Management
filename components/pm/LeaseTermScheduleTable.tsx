// LeaseTermScheduleTable — read-only "Lease Summary" rendering of a lease's
// rent-escalation schedule on the detail pages. Reproduces the client's sheet:
// per-period Base/OPEX/Tax ($/sf and monthly), totals before tax (monthly +
// annual) and the Total With GST/QST line. The currently-active Term period is
// highlighted. Amounts are computed server-side (period.amounts) so this is
// purely presentational.
"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/pm/currency";
import { formatDateOnly } from "@/lib/utils/dateInput";
import type { PeriodAmounts } from "@/lib/pm/rentSchedule";
import type { LeaseTermKind } from "@/types/pm";

export interface SchedulePeriodView {
  label: string;
  kind: LeaseTermKind;
  startDate: string | null;
  endDate: string | null;
  sizeSqft: number;
  baseRatePerSqft: number;
  opexRatePerSqft: number;
  taxRatePerSqft: number;
  amounts: PeriodAmounts;
}

interface Props {
  periods: SchedulePeriodView[];
  proportionateSharePct?: number | null;
  salesTaxRatePct?: number | null;
}

function isActive(p: SchedulePeriodView): boolean {
  if (p.kind !== "Term" || !p.startDate || !p.endDate) return false;
  const now = Date.now();
  return (
    now >= new Date(p.startDate).getTime() && now <= new Date(p.endDate).getTime()
  );
}

export function LeaseTermScheduleTable({
  periods,
  proportionateSharePct,
  salesTaxRatePct,
}: Props) {
  if (!periods || periods.length === 0) {
    return <p className="text-sm text-fg-muted">No rent schedule recorded.</p>;
  }
  const showGst = salesTaxRatePct != null && salesTaxRatePct > 0;
  return (
    <div className="space-y-2">
      {(proportionateSharePct != null || showGst) && (
        <div className="flex gap-4 text-xs text-fg-muted">
          {proportionateSharePct != null && (
            <span>
              Proportionate share:{" "}
              <span className="font-medium text-fg">{proportionateSharePct}%</span>
            </span>
          )}
          {showGst && (
            <span>
              GST/QST rate:{" "}
              <span className="font-medium text-fg">{salesTaxRatePct}%</span>
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="py-2 pr-3">Period</th>
              <th className="pr-3">Term</th>
              <th className="pr-3 text-right">Sq ft</th>
              <th className="pr-3 text-right">Base ($/sf · /mo)</th>
              <th className="pr-3 text-right">OPEX ($/sf · /mo)</th>
              <th className="pr-3 text-right">Taxes ($/sf · /mo)</th>
              <th className="pr-3 text-right">Total /mo</th>
              <th className="pr-3 text-right">Total /yr</th>
              {showGst && <th className="text-right">With GST/QST /mo</th>}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => {
              const a = p.amounts;
              const active = isActive(p);
              const option = p.kind === "RenewalOption";
              return (
                <tr
                  key={i}
                  className={
                    "border-b border-border/40 " +
                    (active ? "bg-primary/5 " : "") +
                    (option ? "text-fg-muted" : "")
                  }
                >
                  <td className="py-2 pr-3">
                    <span className="font-medium">{p.label}</span>
                    {active && (
                      <Badge variant="gain" className="ml-2">
                        Current
                      </Badge>
                    )}
                    {option && (
                      <Badge variant="muted" className="ml-2">
                        Option
                      </Badge>
                    )}
                  </td>
                  <td className="pr-3 text-fg-muted">
                    {p.startDate ? formatDateOnly(p.startDate) : "—"} →{" "}
                    {p.endDate ? formatDateOnly(p.endDate) : "—"}
                  </td>
                  <td className="pr-3 text-right">{p.sizeSqft || "—"}</td>
                  <td className="pr-3 text-right">
                    ${p.baseRatePerSqft} · {formatMoney(a.baseMonthly)}
                  </td>
                  <td className="pr-3 text-right">
                    {p.opexRatePerSqft
                      ? `$${p.opexRatePerSqft} · ${formatMoney(a.opexMonthly)}`
                      : "—"}
                  </td>
                  <td className="pr-3 text-right">
                    {p.taxRatePerSqft
                      ? `$${p.taxRatePerSqft} · ${formatMoney(a.taxMonthly)}`
                      : "—"}
                  </td>
                  <td className="pr-3 text-right font-medium">
                    {formatMoney(a.totalBeforeTaxMonthly)}
                  </td>
                  <td className="pr-3 text-right">
                    {formatMoney(a.totalBeforeTaxAnnual)}
                  </td>
                  {showGst && (
                    <td className="text-right">
                      {option ? "—" : formatMoney(a.totalWithGstMonthly)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">
        Proportionate share &amp; GST/QST are summary figures and are not posted to
        the ledger. Only the active term period drives rent posting.
      </p>
    </div>
  );
}

export default LeaseTermScheduleTable;
