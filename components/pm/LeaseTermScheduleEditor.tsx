// LeaseTermScheduleEditor — repeatable editor for a commercial lease's
// rent-escalation schedule (the client's "Lease Summary": Year 1‑2, Year 3‑5,
// … plus Renewal Options). Mirrors the existing tenants-array add/remove
// pattern used in the lease forms. Each row captures dates + Base Rent / OPEX
// Recovery / Tax Recovery as MONTHLY DOLLAR amounts — what you type is what
// posts each month — and renders the live totals (via computePeriodAmounts).
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
import { formatMoney, fromCents, toCents } from "@/lib/pm/currency";
import {
  annualRatePerSqft,
  computePeriodAmounts,
} from "@/lib/pm/rentSchedule";
import type { LeaseTermKind } from "@/types/pm";
import { toDateInputValueUTC } from "@/lib/utils/dateInput";

export interface ScheduleRow {
  key: string;
  label: string;
  kind: LeaseTermKind;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  sizeSqft: string;
  baseAmount: string; // dollars / month
  baseAccountId: string;
  opexAmount: string; // dollars / month
  opexAccountId: string;
  taxAmount: string; // dollars / month
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
    baseAmount: "",
    baseAccountId: "",
    opexAmount: "",
    opexAccountId: "",
    taxAmount: "",
    taxAccountId: "",
  };
}

/** Convert editor rows to the API payload. Drops fully-blank rows; everything
 *  else is sent so the server validates incomplete rows rather than silently
 *  dropping them. Amounts go over the wire as MONTHLY DOLLARS (the project-wide
 *  convention); the route converts to cents. */
export function scheduleRowsToPayload(rows: ScheduleRow[]) {
  return rows
    .filter(
      (r) =>
        r.label.trim() ||
        r.startDate ||
        r.endDate ||
        Number(r.baseAmount) > 0 ||
        Number(r.opexAmount) > 0 ||
        Number(r.taxAmount) > 0,
    )
    .map((r) => ({
      label: r.label.trim() || "(unnamed)",
      kind: r.kind,
      startDate: r.startDate,
      endDate: r.endDate,
      sizeSqft: Number(r.sizeSqft) || 0,
      baseMonthlyAmount: Number(r.baseAmount) || 0,
      baseAccountId: r.baseAccountId || undefined,
      opexMonthlyAmount: Number(r.opexAmount) || 0,
      opexAccountId: r.opexAccountId || undefined,
      taxMonthlyAmount: Number(r.taxAmount) || 0,
      taxAccountId: r.taxAccountId || undefined,
    }));
}

interface ApiPeriod {
  label: string;
  kind: LeaseTermKind;
  startDate: string | null;
  endDate: string | null;
  sizeSqft: number;
  /** cents / month */
  baseMonthlyAmount: number;
  baseAccountId: string | null;
  opexMonthlyAmount: number;
  opexAccountId: string | null;
  taxMonthlyAmount: number;
  taxAccountId: string | null;
}

/** Pre-fill editor rows from an API `rentSchedule` payload (edit flow). The API
 *  returns cents; the inputs show dollars. */
export function scheduleApiToRows(periods: ApiPeriod[] | undefined): ScheduleRow[] {
  const dollars = (cents: number) => (cents ? String(fromCents(cents)) : "");
  return (periods ?? []).map((p) => ({
    key: genKey(),
    label: p.label ?? "",
    kind: p.kind ?? "Term",
    startDate: p.startDate ? toDateInputValueUTC(p.startDate) : "",
    endDate: p.endDate ? toDateInputValueUTC(p.endDate) : "",
    sizeSqft: p.sizeSqft ? String(p.sizeSqft) : "",
    baseAmount: dollars(p.baseMonthlyAmount),
    baseAccountId: p.baseAccountId ?? "",
    opexAmount: dollars(p.opexMonthlyAmount),
    opexAccountId: p.opexAccountId ?? "",
    taxAmount: dollars(p.taxMonthlyAmount),
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

  // Once a schedule exists it DRIVES posting: only the Term period covering the
  // due date posts rent. A schedule whose periods all sit in the past (or leave
  // a gap over today) silently posts nothing — warn rather than let that pass.
  const terms = rows.filter(
    (r) => r.kind === "Term" && r.startDate && r.endDate,
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const noCurrentTerm =
    terms.length > 0 &&
    !terms.some((r) => r.startDate <= todayKey && todayKey <= r.endDate);

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-xs text-fg-muted">
          No rent schedule. Add term periods to record an escalating rent across
          time (past &amp; future), plus any renewal options.
        </p>
      )}

      {noCurrentTerm && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-fg">
          <span className="font-medium">No term period covers today.</span> Rent
          posts only from the term period active on the due date, so nothing will
          post until a period covers the current date. Add or extend a term
          period, or remove the schedule to go back to the revenue rows above.
        </p>
      )}

      {rows.map((r) => {
        const sqft = Number(r.sizeSqft) || 0;
        const amounts = computePeriodAmounts(
          {
            sizeSqft: sqft,
            baseMonthlyAmount: toCents(Number(r.baseAmount) || 0),
            opexMonthlyAmount: toCents(Number(r.opexAmount) || 0),
            taxMonthlyAmount: toCents(Number(r.taxAmount) || 0),
          },
          salesTaxRatePct ?? null,
        );
        const perSqft = annualRatePerSqft(amounts.totalBeforeTaxMonthly, sqft);
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

            {/* Base Rent / OPEX Recovery / Tax Recovery — MONTHLY dollars
                (what you type is what posts) + income account. */}
            {(
              [
                ["base", "Base Rent", r.baseAmount, r.baseAccountId] as const,
                ["opex", "OPEX Recovery", r.opexAmount, r.opexAccountId] as const,
                ["tax", "Tax Recovery", r.taxAmount, r.taxAccountId] as const,
              ]
            ).map(([k, label, amount, acct]) => (
              <div key={k} className="grid grid-cols-[9rem_1fr] items-center gap-2">
                <div>
                  <Label>
                    {label}{" "}
                    <span className="font-normal text-fg-muted">$ / mo</span>
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) =>
                      update(r.key, {
                        [`${k}Amount`]: e.target.value,
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
              {perSqft ? (
                <>
                  {" "}
                  · ≈{" "}
                  <span className="font-medium text-fg">
                    ${perSqft.toFixed(2)}
                  </span>
                  /sf/yr
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
