// LeaseTermScheduleEditor — repeatable editor for a commercial lease's
// rent-escalation schedule (the client's "Lease Summary": Year 1‑2, Year 3‑5,
// … plus Renewal Options). Mirrors the existing tenants-array add/remove
// pattern used in the lease forms. Each row captures dates + Base/OPEX/Tax as
// ANNUAL $/sf rates and renders the live monthly/annual/total/with-GST figures
// exactly like the sheet (via computePeriodAmounts).
//
// State lives in the parent form (controlled via `rows`/`onRowsChange`); this
// component is presentational + arithmetic only. Conversion helpers
// (`scheduleRowsToPayload`, `scheduleApiToRows`) keep the wire format in one place.
"use client";

import * as React from "react";
import { Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/pm/currency";
import { computePeriodAmounts } from "@/lib/pm/rentSchedule";
import type { LeaseTermKind } from "@/types/pm";
import { toDateInputValueUTC } from "@/lib/utils/dateInput";

export interface ScheduleRow {
  key: string;
  label: string;
  kind: LeaseTermKind;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  sizeSqft: string;
  baseRate: string; // annual $/sf
  baseAccountId: string;
  opexRate: string;
  opexAccountId: string;
  taxRate: string;
  taxAccountId: string;
}

interface AccountOption {
  id: string;
  name: string;
}

function genKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyScheduleRow(
  kind: LeaseTermKind = "Term",
  defaultSizeSqft?: number | null,
): ScheduleRow {
  return {
    key: genKey(),
    label: "",
    kind,
    startDate: "",
    endDate: "",
    sizeSqft:
      defaultSizeSqft && defaultSizeSqft > 0 ? String(defaultSizeSqft) : "",
    baseRate: "",
    baseAccountId: "",
    opexRate: "",
    opexAccountId: "",
    taxRate: "",
    taxAccountId: "",
  };
}

/** Convert editor rows to the API payload. Drops fully-blank rows; everything
 *  else is sent so the server validates incomplete rows rather than silently
 *  dropping them. Rates are annual dollars/sf; the server stores them as-is. */
export function scheduleRowsToPayload(rows: ScheduleRow[]) {
  return rows
    .filter(
      (r) =>
        r.label.trim() ||
        r.startDate ||
        r.endDate ||
        Number(r.baseRate) > 0 ||
        Number(r.opexRate) > 0 ||
        Number(r.taxRate) > 0,
    )
    .map((r) => ({
      label: r.label.trim() || "(unnamed)",
      kind: r.kind,
      startDate: r.startDate,
      endDate: r.endDate,
      sizeSqft: Number(r.sizeSqft) || 0,
      baseRatePerSqft: Number(r.baseRate) || 0,
      baseAccountId: r.baseAccountId || undefined,
      opexRatePerSqft: Number(r.opexRate) || 0,
      opexAccountId: r.opexAccountId || undefined,
      taxRatePerSqft: Number(r.taxRate) || 0,
      taxAccountId: r.taxAccountId || undefined,
    }));
}

interface ApiPeriod {
  label: string;
  kind: LeaseTermKind;
  startDate: string | null;
  endDate: string | null;
  sizeSqft: number;
  baseRatePerSqft: number;
  baseAccountId: string | null;
  opexRatePerSqft: number;
  opexAccountId: string | null;
  taxRatePerSqft: number;
  taxAccountId: string | null;
}

/** Pre-fill editor rows from an API `rentSchedule` payload (edit flow). */
export function scheduleApiToRows(periods: ApiPeriod[] | undefined): ScheduleRow[] {
  return (periods ?? []).map((p) => ({
    key: genKey(),
    label: p.label ?? "",
    kind: p.kind ?? "Term",
    startDate: p.startDate ? toDateInputValueUTC(p.startDate) : "",
    endDate: p.endDate ? toDateInputValueUTC(p.endDate) : "",
    sizeSqft: p.sizeSqft ? String(p.sizeSqft) : "",
    baseRate: p.baseRatePerSqft ? String(p.baseRatePerSqft) : "",
    baseAccountId: p.baseAccountId ?? "",
    opexRate: p.opexRatePerSqft ? String(p.opexRatePerSqft) : "",
    opexAccountId: p.opexAccountId ?? "",
    taxRate: p.taxRatePerSqft ? String(p.taxRatePerSqft) : "",
    taxAccountId: p.taxAccountId ?? "",
  }));
}

interface Props {
  rows: ScheduleRow[];
  onRowsChange: (rows: ScheduleRow[]) => void;
  incomeAccounts: AccountOption[];
  defaultSizeSqft?: number | null;
  /** Combined GST/QST rate (e.g. 14.975) for the live "with tax" preview. */
  salesTaxRatePct?: number | null;
}

const selectCls =
  "w-full rounded border bg-background px-2 py-1.5 text-sm";

export function LeaseTermScheduleEditor({
  rows,
  onRowsChange,
  incomeAccounts,
  defaultSizeSqft,
  salesTaxRatePct,
}: Props) {
  const update = (key: string, patch: Partial<ScheduleRow>) =>
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onRowsChange(rows.filter((r) => r.key !== key));
  const add = (kind: LeaseTermKind) =>
    onRowsChange([...rows, emptyScheduleRow(kind, defaultSizeSqft)]);

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-xs text-fg-muted">
          No rent schedule. Add term periods to record an escalating rent across
          time (past &amp; future), plus any renewal options.
        </p>
      )}

      {rows.map((r) => {
        const amounts = computePeriodAmounts(
          {
            sizeSqft: Number(r.sizeSqft) || 0,
            baseRatePerSqft: Number(r.baseRate) || 0,
            opexRatePerSqft: Number(r.opexRate) || 0,
            taxRatePerSqft: Number(r.taxRate) || 0,
          },
          salesTaxRatePct ?? null,
        );
        const isOption = r.kind === "RenewalOption";
        return (
          <div
            key={r.key}
            className={
              "rounded border p-3 space-y-2 " +
              (isOption ? "border-dashed border-border bg-surface/50" : "border-border")
            }
          >
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>Period label</Label>
                <Input
                  value={r.label}
                  placeholder={isOption ? "Renewal Option" : "Year 1-2"}
                  onChange={(e) => update(r.key, { label: e.target.value })}
                />
              </div>
              <div className="w-40">
                <Label>Type</Label>
                <select
                  className={selectCls}
                  value={r.kind}
                  onChange={(e) =>
                    update(r.key, { kind: e.target.value as LeaseTermKind })
                  }
                >
                  <option value="Term">Term (posts rent)</option>
                  <option value="RenewalOption">Renewal option</option>
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => remove(r.key)}
                aria-label="Remove period"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={r.startDate}
                  onChange={(e) => update(r.key, { startDate: e.target.value })}
                />
              </div>
              <div>
                <Label>End date</Label>
                <Input
                  type="date"
                  value={r.endDate}
                  onChange={(e) => update(r.key, { endDate: e.target.value })}
                />
              </div>
              <div>
                <Label>Sq ft</Label>
                <Input
                  type="number"
                  value={r.sizeSqft}
                  onChange={(e) => update(r.key, { sizeSqft: e.target.value })}
                />
              </div>
            </div>

            {/* Base / OPEX / Tax — annual $/sf + income account. */}
            {(
              [
                ["base", "Base Rent", r.baseRate, r.baseAccountId] as const,
                ["opex", "OPEX", r.opexRate, r.opexAccountId] as const,
                ["tax", "Taxes", r.taxRate, r.taxAccountId] as const,
              ]
            ).map(([k, label, rate, acct]) => (
              <div key={k} className="grid grid-cols-[7rem_1fr] items-center gap-2">
                <div>
                  <Label>{label} $/sf/yr</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={rate}
                    onChange={(e) =>
                      update(r.key, {
                        [`${k}Rate`]: e.target.value,
                      } as Partial<ScheduleRow>)
                    }
                  />
                </div>
                <div>
                  <Label>{label} income account</Label>
                  <select
                    className={selectCls}
                    value={acct}
                    onChange={(e) =>
                      update(r.key, {
                        [`${k}AccountId`]: e.target.value,
                      } as Partial<ScheduleRow>)
                    }
                  >
                    <option value="">— select —</option>
                    {incomeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}

            <div className="rounded bg-surface px-2 py-1 text-xs text-fg-muted">
              {isOption && (
                <span className="mr-2 font-bold text-fg">
                  Recorded only — does not post.
                </span>
              )}
              Monthly{" "}
              <span className="font-medium text-fg">
                {formatMoney(amounts.totalBeforeTaxMonthly)}
              </span>{" "}
              · Annual{" "}
              <span className="font-medium text-fg">
                {formatMoney(amounts.totalBeforeTaxAnnual)}
              </span>
              {salesTaxRatePct ? (
                <>
                  {" "}
                  · With GST/QST/mo{" "}
                  <span className="font-medium text-fg">
                    {formatMoney(amounts.totalWithGstMonthly)}
                  </span>
                </>
              ) : null}
              <span className="ml-2">
                (Base {formatMoney(amounts.baseMonthly)} · OPEX{" "}
                {formatMoney(amounts.opexMonthly)} · Tax{" "}
                {formatMoney(amounts.taxMonthly)})
              </span>
            </div>
          </div>
        );
      })}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => add("Term")}>
          <Plus className="mr-1 h-4 w-4" /> Add term period
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => add("RenewalOption")}
        >
          <Plus className="mr-1 h-4 w-4" /> Add renewal option
        </Button>
      </div>
    </div>
  );
}

export default LeaseTermScheduleEditor;
