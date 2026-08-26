// LeaseTermScheduleTable — read-only "Lease Summary" rendering of a lease's
// rent-escalation schedule on the detail pages. Reproduces the client's sheet:
// per-period Base/OPEX/Tax ($/sf and monthly), totals before tax (monthly +
// annual) and the Total With GST/QST line. The currently-active Term period is
// highlighted. Amounts are computed server-side (period.amounts) so this is
// purely presentational.
"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { usePmMoneyFormatter } from "@/components/pm/PmCurrencyProvider";
import { formatDateOnly } from "@/lib/utils/dateInput";
import type { PeriodAmounts } from "@/lib/pm/rentSchedule";
import type { LeaseTermKind, LeaseType } from "@/types/pm";

export interface SchedulePeriodView {
  label: string;
  kind: LeaseTermKind;
  /** Absent on periods stored before the field existed — read as `Fixed`. */
  leaseType?: LeaseType | null;
  startDate: string | null;
  /** Null on an open-ended At-will period. */
  endDate: string | null;
  sizeSqft: number;
  /** cents / month */
  baseMonthlyAmount: number;
  opexMonthlyAmount: number;
  taxMonthlyAmount: number;
  amounts: PeriodAmounts;
}

interface Props {
  periods: SchedulePeriodView[];
  proportionateSharePct?: number | null;
  salesTaxRatePct?: number | null;
}

/** Mirrors `activeTermPeriodForDate`: a null end date means open-ended (only an
 *  At-will period may be), so it stays current until a later period takes over. */
function isActive(p: SchedulePeriodView): boolean {
  if (p.kind !== "Term" || !p.startDate) return false;
  const now = Date.now();
  if (now < new Date(p.startDate).getTime()) return false;
  return !p.endDate || now <= new Date(p.endDate).getTime();
}

export function LeaseTermScheduleTable({
  periods,
  proportionateSharePct,
  salesTaxRatePct,
}: Props) {
  // Must precede the early return below — rules of hooks.
  const fmt = usePmMoneyFormatter();
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
              <span className="font-medium text-fg">
                {proportionateSharePct}%
              </span>
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
              <th className="pr-3 text-right">Base Rent /mo</th>
              <th className="pr-3 text-right">OPEX Recovery /mo</th>
              <th className="pr-3 text-right">Tax Recovery /mo</th>
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
                    {/* Only worth the ink when it isn't the default. */}
                    {p.leaseType && p.leaseType !== "Fixed" && (
                      <span className="ml-2 text-xs text-fg-muted">
                        {p.leaseType}
                      </span>
                    )}
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
                    {p.endDate
                      ? formatDateOnly(p.endDate)
                      : p.leaseType === "At-will"
                        ? "At-will"
                        : "—"}
                  </td>
                  <td className="pr-3 text-right">{p.sizeSqft || "—"}</td>
                  <td className="pr-3 text-right">{fmt(a.baseMonthly)}</td>
                  <td className="pr-3 text-right">
                    {a.opexMonthly ? fmt(a.opexMonthly) : "—"}
                  </td>
                  <td className="pr-3 text-right">
                    {a.taxMonthly ? fmt(a.taxMonthly) : "—"}
                  </td>
                  <td className="pr-3 text-right font-medium">
                    {fmt(a.totalBeforeTaxMonthly)}
                  </td>
                  <td className="pr-3 text-right">
                    {fmt(a.totalBeforeTaxAnnual)}
                  </td>
                  {showGst && (
                    <td className="text-right">
                      {option ? "—" : fmt(a.totalWithGstMonthly)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">
        Proportionate share &amp; GST/QST are summary figures and are not posted
        to the ledger. Only the active term period drives rent posting.
      </p>
    </div>
  );
}

export default LeaseTermScheduleTable;
