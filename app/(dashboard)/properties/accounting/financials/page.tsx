// /properties/accounting/financials — multi-property P&L matrix (skeleton).
//
// Rows = Income + Operating Expense CoA. Columns = active Properties +
// Company. Cells are signed nets — each cell is a click-through into the
// General Ledger with `account × property × period` pre-applied (BR-AC-15).
// Cash↔Accrual toggle flips Organization.accountingMode via PATCH; the
// matrix endpoint currently returns the same numbers in both modes (Phase 9
// implements true cash-basis), but the toggle still demonstrates BR-AC-2
// (toggling NEVER modifies the journal — only the read path).
"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { fromCents } from "@/lib/pm/currency";

interface Account {
  id: string;
  name: string;
  type: string;
}
interface Column {
  id: string;
  name: string;
}
interface Cell {
  accountId: string;
  propertyId: string;
  amount: number;
}
interface Matrix {
  accountingMode: "cash" | "accrual";
  estimatedIncomeTaxRatePct: number;
  accounts: Account[];
  columns: Column[];
  cells: Cell[];
}
interface ReconReasonBucket {
  count: number;
  cents: number;
}
interface ReconSummary {
  totalUnreflected: number;
  totalUnreflectedCents: number;
  byReason: Record<string, ReconReasonBucket>;
}

// Human phrases for the "not reflected" banner breakdown, keyed by the
// reconciliation API's reason codes (lib/pm/billReflection.ts).
const RECON_REASON_PHRASE: Record<string, string> = {
  UNPOSTED: "draft / unposted",
  JE_MISSING: "missing journal entry",
  NON_PL_ACCOUNT: "non-P&L account",
  OUTSIDE_DATE_RANGE: "outside this date range",
};

function reconBreakdown(summary: ReconSummary): string {
  return Object.entries(summary.byReason)
    .filter(([, v]) => v.count > 0)
    .map(([k, v]) => `${v.count} ${RECON_REASON_PHRASE[k] ?? k}`)
    .join(", ");
}

// Period selector: flip the single from/to window between a whole month, a
// whole year, or a hand-picked range. The matrix/reconciliation routes already
// take from/to, so this is purely a client-side convenience over them — no API
// change. Bounds are built as date-only UTC-midnight strings to match the rest
// of the P&L (the "to" boundary is inclusive, like the existing `to = today`).
type PeriodMode = "month" | "year" | "range";

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last of this
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

function yearBounds(y: number): { from: string; to: string } {
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export default function FinancialsPage() {
  const { toast } = useToast();
  const today = new Date();
  const initialMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}`;
  const initialBounds = monthBounds(initialMonth);
  const [mode, setMode] = React.useState<PeriodMode>("month");
  const [month, setMonth] = React.useState<string>(initialMonth);
  const [year, setYear] = React.useState<number>(today.getFullYear());
  const [from, setFrom] = React.useState<string>(initialBounds.from);
  const [to, setTo] = React.useState<string>(initialBounds.to);
  const [data, setData] = React.useState<Matrix | null>(null);
  const [recon, setRecon] = React.useState<ReconSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [toggling, setToggling] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    // Pull the matrix and the bill-reconciliation summary for the same window
    // together, so the banner reflects exactly what this view does/doesn't show.
    const [matrixRes, reconRes] = await Promise.all([
      fetch(`/api/pm/financials/matrix?${params.toString()}`),
      fetch(`/api/pm/financials/reconciliation?${params.toString()}`),
    ]);
    if (matrixRes.ok) setData((await matrixRes.json()) as Matrix);
    if (reconRes.ok) {
      setRecon(((await reconRes.json()) as { summary: ReconSummary }).summary);
    }
    setLoading(false);
  }, [from, to]);

  React.useEffect(() => {
    load();
  }, [load]);

  function applyMonth(ym: string) {
    setMonth(ym);
    const b = monthBounds(ym);
    setFrom(b.from);
    setTo(b.to);
  }
  function applyYear(y: number) {
    setYear(y);
    const b = yearBounds(y);
    setFrom(b.from);
    setTo(b.to);
  }
  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const d = new Date(y, m - 1 + delta, 1); // rolls across year boundaries
    applyMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  function switchMode(next: PeriodMode) {
    setMode(next);
    if (next === "month") applyMonth(month);
    else if (next === "year") applyYear(year);
    // "range" keeps the current from/to so the user can hand-edit them.
  }

  const periodLabel =
    mode === "month"
      ? new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        })
      : mode === "year"
        ? String(year)
        : `${from || "…"} → ${to || "…"}`;

  async function toggleAccountingMode() {
    if (!data) return;
    setToggling(true);
    const newMode = data.accountingMode === "cash" ? "accrual" : "cash";
    const res = await fetch("/api/pm/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountingMode: newMode }),
    });
    setToggling(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Toggle failed",
        description: err.error ?? "Admin only?",
        variant: "error",
      });
      return;
    }
    toast({
      title: `Switched to ${newMode} basis`,
      description: "Journal data unchanged (BR-AC-2).",
      variant: "success",
    });
    await load();
  }

  const cellMap = React.useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const c of data.cells) m.set(`${c.accountId}|${c.propertyId}`, c.amount);
    return m;
  }, [data]);

  const incomeAccounts = data?.accounts.filter((a) => a.type === "Income") ?? [];
  const expenseAccounts =
    data?.accounts.filter((a) => a.type === "Operating Expense") ?? [];

  function cellAmount(accountId: string, columnId: string): number {
    return cellMap.get(`${accountId}|${columnId}`) ?? 0;
  }
  function rowTotal(accountId: string): number {
    let s = 0;
    if (!data) return 0;
    for (const col of data.columns) s += cellAmount(accountId, col.id);
    return s;
  }
  function columnTotal(columnId: string, accounts: Account[]): number {
    let s = 0;
    for (const a of accounts) s += cellAmount(a.id, columnId);
    return s;
  }

  // §6 — derived estimated income-tax footer (company-column only, no GL
  // write). Applies the org rate to positive grand net income.
  const grandNetCents = data
    ? data.columns.reduce(
        (s, col) =>
          s +
          columnTotal(col.id, incomeAccounts) -
          columnTotal(col.id, expenseAccounts),
        0,
      )
    : 0;
  const taxRatePct = data?.estimatedIncomeTaxRatePct ?? 0;
  const estimatedTaxCents = Math.round(
    (Math.max(0, grandNetCents) * taxRatePct) / 100,
  );
  const afterTaxNetCents = grandNetCents - estimatedTaxCents;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Financials — Profit &amp; Loss</CardTitle>
          <div className="flex items-center gap-3">
            {data && (
              <span className="rounded border border-border bg-surface px-2 py-0.5 text-xs uppercase tracking-widest text-fg-muted">
                {data.accountingMode} basis
              </span>
            )}
            <Button size="sm" variant="outline" onClick={toggleAccountingMode} disabled={toggling || !data}>
              {toggling
                ? "Switching…"
                : `Switch to ${data?.accountingMode === "cash" ? "accrual" : "cash"}`}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex overflow-hidden rounded border border-border">
                {(["month", "year", "range"] as PeriodMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    className={
                      "px-3 py-1 text-xs font-medium " +
                      (mode === m
                        ? "bg-fg text-bg"
                        : "bg-surface text-fg-muted hover:text-fg")
                    }
                  >
                    {m === "month" ? "Month" : m === "year" ? "Year" : "Custom range"}
                  </button>
                ))}
              </div>

              {mode === "month" && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Previous month"
                  >
                    ‹
                  </Button>
                  <Input
                    type="month"
                    value={month}
                    onChange={(e) => applyMonth(e.target.value)}
                    className="h-9 w-44"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => shiftMonth(1)}
                    aria-label="Next month"
                  >
                    ›
                  </Button>
                </div>
              )}

              {mode === "year" && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => applyYear(year - 1)}
                    aria-label="Previous year"
                  >
                    ‹
                  </Button>
                  <Input
                    type="number"
                    value={year}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      if (y >= 1900 && y <= 3000) applyYear(y);
                    }}
                    className="h-9 w-28 tabular-nums"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => applyYear(year + 1)}
                    aria-label="Next year"
                  >
                    ›
                  </Button>
                </div>
              )}
            </div>

            {mode === "range" && (
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label>From</Label>
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label>To</Label>
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            )}

            <p className="text-xs text-fg-muted">
              Showing{" "}
              <span className="font-medium text-fg">{periodLabel}</span>
            </p>
          </div>

          {recon && recon.totalUnreflected > 0 && (
            <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-fg">
              <span className="font-bold">
                {recon.totalUnreflected} bill
                {recon.totalUnreflected === 1 ? "" : "s"} totaling{" "}
                <CurrencyAmount value={fromCents(recon.totalUnreflectedCents)} />
              </span>{" "}
              {recon.totalUnreflected === 1 ? "is" : "are"} not reflected here
              {reconBreakdown(recon) ? ` (${reconBreakdown(recon)})` : ""}.{" "}
              <Link
                href="/properties/accounting/bills"
                className="font-bold underline"
              >
                Review bills →
              </Link>
            </div>
          )}

          {loading && <p className="text-sm text-fg-muted">Loading…</p>}
          {!loading && data && data.accounts.length === 0 && (
            <p className="text-sm text-fg-muted">
              No income or expense accounts have been used yet. Post a journal
              entry to populate this matrix.
            </p>
          )}
          {!loading && data && data.accounts.length > 0 && (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-widest text-fg-muted">
                  <tr>
                    <th className="px-2 py-2">Account</th>
                    {data.columns.map((c) => (
                      <th key={c.id} className="px-2 py-2 text-right">
                        {c.name}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <SectionHeader
                    label="Income"
                    colSpan={data.columns.length + 2}
                  />
                  {incomeAccounts.map((a) => (
                    <MatrixRow
                      key={a.id}
                      account={a}
                      columns={data.columns}
                      cellAmount={cellAmount}
                      from={from}
                      to={to}
                      total={rowTotal(a.id)}
                    />
                  ))}
                  <TotalsRow
                    label="Income subtotal"
                    columns={data.columns}
                    valueFor={(colId) => columnTotal(colId, incomeAccounts)}
                  />
                  <SectionHeader
                    label="Operating expenses"
                    colSpan={data.columns.length + 2}
                  />
                  {expenseAccounts.map((a) => (
                    <MatrixRow
                      key={a.id}
                      account={a}
                      columns={data.columns}
                      cellAmount={cellAmount}
                      from={from}
                      to={to}
                      total={rowTotal(a.id)}
                    />
                  ))}
                  <TotalsRow
                    label="Expense subtotal"
                    columns={data.columns}
                    valueFor={(colId) => columnTotal(colId, expenseAccounts)}
                  />
                  <TotalsRow
                    label="Net (Income − Expense)"
                    columns={data.columns}
                    bold
                    valueFor={(colId) =>
                      columnTotal(colId, incomeAccounts) -
                      columnTotal(colId, expenseAccounts)
                    }
                  />
                  {/* §6 — derived estimated income tax (company column only)
                      + after-tax net. Shown once a rate is configured. */}
                  {taxRatePct > 0 && (
                    <>
                      <tr className="border-b border-border bg-surface">
                        <td className="px-2 py-1 text-xs uppercase tracking-widest text-fg-muted">
                          Estimated income taxes ({taxRatePct}%)
                        </td>
                        {data.columns.map((c) => (
                          <td key={c.id} className="px-2 py-1 text-right">
                            {c.id === "company" ? (
                              <CurrencyAmount
                                value={fromCents(-estimatedTaxCents)}
                              />
                            ) : (
                              <span className="text-fg-muted">—</span>
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right">
                          <CurrencyAmount value={fromCents(-estimatedTaxCents)} />
                        </td>
                      </tr>
                      <tr className="border-b border-border bg-surface">
                        <td className="px-2 py-1 text-xs font-bold uppercase tracking-widest text-fg-muted">
                          After-tax net
                        </td>
                        {data.columns.map((c) => (
                          <td
                            key={c.id}
                            className="px-2 py-1 text-right text-fg-muted"
                          >
                            —
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right font-bold">
                          <CurrencyAmount value={fromCents(afterTaxNetCents)} />
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MatrixRow({
  account,
  columns,
  cellAmount,
  from,
  to,
  total,
}: {
  account: Account;
  columns: Column[];
  cellAmount: (accountId: string, columnId: string) => number;
  from: string;
  to: string;
  total: number;
}) {
  return (
    <tr className="border-b border-border/30">
      <td className="px-2 py-1 text-fg">{account.name}</td>
      {columns.map((c) => {
        const v = cellAmount(account.id, c.id);
        const href = drillHref(account.id, c.id, from, to);
        return (
          <td key={c.id} className="px-2 py-1 text-right">
            {v === 0 ? (
              <span className="text-fg-muted">—</span>
            ) : (
              <Link href={href} className="hover:underline">
                <CurrencyAmount value={fromCents(v)} />
              </Link>
            )}
          </td>
        );
      })}
      <td className="px-2 py-1 text-right font-medium">
        <CurrencyAmount value={fromCents(total)} />
      </td>
    </tr>
  );
}

function SectionHeader({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr className="bg-surface-high">
      <td
        colSpan={colSpan}
        className="px-2 py-1 text-xs font-bold uppercase tracking-widest text-fg-muted"
      >
        {label}
      </td>
    </tr>
  );
}

function TotalsRow({
  label,
  columns,
  valueFor,
  bold = false,
}: {
  label: string;
  columns: Column[];
  valueFor: (columnId: string) => number;
  bold?: boolean;
}) {
  let grand = 0;
  for (const c of columns) grand += valueFor(c.id);
  return (
    <tr className="border-b border-border bg-surface">
      <td
        className={
          "px-2 py-1 text-xs uppercase tracking-widest text-fg-muted " +
          (bold ? "font-bold" : "")
        }
      >
        {label}
      </td>
      {columns.map((c) => (
        <td
          key={c.id}
          className={"px-2 py-1 text-right " + (bold ? "font-bold" : "")}
        >
          <CurrencyAmount value={fromCents(valueFor(c.id))} />
        </td>
      ))}
      <td className={"px-2 py-1 text-right " + (bold ? "font-bold" : "")}>
        <CurrencyAmount value={fromCents(grand)} />
      </td>
    </tr>
  );
}

function drillHref(
  accountId: string,
  columnId: string,
  from: string,
  to: string,
): string {
  const params = new URLSearchParams();
  params.set("accountId", accountId);
  if (columnId !== "company") params.set("propertyId", columnId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return `/properties/accounting/general-ledger?${params.toString()}`;
}
