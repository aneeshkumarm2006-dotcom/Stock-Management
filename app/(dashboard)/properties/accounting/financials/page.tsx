// /properties/accounting/financials — multi-property P&L matrix (skeleton).
//
// Rows = Income + Operating Expense CoA. Columns = active Properties +
// Company. Cells are signed nets — each cell is a click-through into the
// General Ledger with `account × property × period` pre-applied (BR-AC-15).
// Cash↔Accrual toggle flips Organization.accountingMode via PATCH; the
// matrix endpoint currently returns the same numbers in both modes (Phase 9
// implements true cash-basis), but the toggle still demonstrates BR-AC-2
// (toggling NEVER modifies the journal — only the read path).
//
// CURRENCY. A Montreal building books in CAD and a Florida one in USD, so the
// old `s += cellAmount(...)` row and grand totals were adding unlike units and
// then labelling the result with whichever currency the top-bar toggle happened
// to be on. Now:
//   - each property column renders in its OWN currency and never converts;
//   - a "CAD total" / "USD total" subtotal column closes each currency group;
//   - only the Total column converts, via MoneyTotal over a MoneyByCurrency.
// So `CAD total + USD total == Total` is checkable by eye, which is the
// reconciliation the client actually performs.
//
// The subtotal columns are a CLIENT-SIDE view model and are deliberately NOT
// pushed into `data.columns`: row renderers iterate the view model, but every
// total computation iterates `data.columns` only. Mixing the two would make the
// subtotals count themselves.
"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { MoneyTotal } from "@/components/pm/MoneyTotal";
import { addMoney, type MoneyByCurrency } from "@/lib/pm/moneyByCurrency";
import type { PmCurrency } from "@/types/pm";

interface Account {
  id: string;
  name: string;
  type: string;
}
interface Column {
  id: string;
  name: string;
  /** Resolved server-side; always concrete. Determines every cell beneath it. */
  currency: PmCurrency;
}
interface Cell {
  accountId: string;
  propertyId: string;
  amount: number;
}
interface Matrix {
  accountingMode: "cash" | "accrual";
  estimatedIncomeTaxRatePct: number;
  orgDefaultCurrency: PmCurrency;
  accounts: Account[];
  columns: Column[];
  cells: Cell[];
}

/**
 * What the table actually draws: the real property columns, with a synthetic
 * per-currency subtotal column closing each currency group. Only `kind:
 * "property"` entries correspond to a `data.columns` row — totals must never
 * iterate this list.
 */
type RenderCol =
  | { kind: "property"; id: string; name: string; currency: PmCurrency }
  | { kind: "subtotal"; currency: PmCurrency };

const renderColKey = (c: RenderCol) =>
  c.kind === "property" ? c.id : `subtotal:${c.currency}`;

/** Org-default currency group first, then the rest alphabetically. */
function orderCurrencies(
  present: PmCurrency[],
  orgDefault: PmCurrency,
): PmCurrency[] {
  return [...present].sort((a, b) => {
    if (a === b) return 0;
    if (a === orgDefault) return -1;
    if (b === orgDefault) return 1;
    return a.localeCompare(b);
  });
}
interface ReconReasonBucket {
  count: number;
  cents: number;
  totals: MoneyByCurrency;
}
interface ReconSummary {
  totalUnreflected: number;
  /** @deprecated mixes currencies — use `totals`. */
  totalUnreflectedCents: number;
  totals: MoneyByCurrency;
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
  /** Currency-tagged: a row spans every column, so it can span currencies. */
  function rowTotals(accountId: string): MoneyByCurrency {
    const acc: MoneyByCurrency = {};
    if (!data) return acc;
    for (const col of data.columns) {
      addMoney(acc, col.currency, cellAmount(accountId, col.id));
    }
    return acc;
  }
  /** Single column ⇒ single currency ⇒ a plain number is correct here. */
  function columnTotal(columnId: string, accounts: Account[]): number {
    let s = 0;
    for (const a of accounts) s += cellAmount(a.id, columnId);
    return s;
  }
  /** Sum of the columns booking in one currency — same unit throughout. */
  function currencySubtotal(
    currency: PmCurrency,
    accounts: Account[],
  ): number {
    if (!data) return 0;
    let s = 0;
    for (const col of data.columns) {
      if (col.currency === currency) s += columnTotal(col.id, accounts);
    }
    return s;
  }

  // The currency groups actually present, and the render list that closes each
  // one with a subtotal column. Company sits in the org-default group, so that
  // subtotal is labelled by currency ("CAD total") rather than by geography —
  // it is not "the Canadian properties", and a footnote below says so.
  const currencies = React.useMemo<PmCurrency[]>(() => {
    if (!data) return [];
    return orderCurrencies(
      Array.from(new Set(data.columns.map((c) => c.currency))),
      data.orgDefaultCurrency,
    );
  }, [data]);

  const renderCols = React.useMemo<RenderCol[]>(() => {
    if (!data) return [];
    const out: RenderCol[] = [];
    for (const cur of currencies) {
      for (const c of data.columns) {
        if (c.currency !== cur) continue;
        out.push({
          kind: "property",
          id: c.id,
          name: c.name,
          currency: c.currency,
        });
      }
      // A lone currency group would make the subtotal a duplicate of the Total
      // column, so only draw it when there is genuinely something to separate.
      if (currencies.length > 1) out.push({ kind: "subtotal", currency: cur });
    }
    return out;
  }, [data, currencies]);

  // §6 — derived estimated income-tax footer (no GL write). Bucketed per
  // currency: a US loss no longer offsets Canadian profit, which is both the
  // more defensible reading (two tax authorities) and the only way to keep this
  // line independent of a live FX rate.
  const grandNet = React.useMemo<MoneyByCurrency>(() => {
    const acc: MoneyByCurrency = {};
    if (!data) return acc;
    for (const col of data.columns) {
      addMoney(
        acc,
        col.currency,
        columnTotal(col.id, incomeAccounts) -
          columnTotal(col.id, expenseAccounts),
      );
    }
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cellMap]);

  const taxRatePct = data?.estimatedIncomeTaxRatePct ?? 0;
  const estimatedTax = React.useMemo<MoneyByCurrency>(() => {
    const acc: MoneyByCurrency = {};
    for (const [cur, cents] of Object.entries(grandNet)) {
      acc[cur as PmCurrency] = Math.round(
        (Math.max(0, cents ?? 0) * taxRatePct) / 100,
      );
    }
    return acc;
  }, [grandNet, taxRatePct]);
  const afterTaxNet = React.useMemo<MoneyByCurrency>(() => {
    const acc: MoneyByCurrency = {};
    for (const [cur, cents] of Object.entries(grandNet)) {
      acc[cur as PmCurrency] =
        (cents ?? 0) - (estimatedTax[cur as PmCurrency] ?? 0);
    }
    return acc;
  }, [grandNet, estimatedTax]);

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
                <MoneyTotal totals={recon.totals} />
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
                    {renderCols.map((c) => (
                      <th
                        key={renderColKey(c)}
                        className={
                          "px-2 py-2 text-right align-bottom " +
                          (c.kind === "subtotal"
                            ? "border-l border-border bg-surface-high"
                            : "")
                        }
                      >
                        {c.kind === "property" ? c.name : `${c.currency} total`}
                        {/* Block child: adds height once for every header, so
                            rows stay aligned and no column gets wider. An
                            inline tag would force horizontal scroll. */}
                        <span className="block text-[10px] font-normal normal-case tracking-normal text-fg-muted">
                          {c.currency}
                        </span>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right align-bottom">
                      Total
                      <span className="block text-[10px] font-normal normal-case tracking-normal text-fg-muted">
                        converted
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <SectionHeader
                    label="Income"
                    colSpan={renderCols.length + 2}
                  />
                  {incomeAccounts.map((a) => (
                    <MatrixRow
                      key={a.id}
                      account={a}
                      renderCols={renderCols}
                      cellAmount={cellAmount}
                      currencySubtotal={(cur) =>
                        currencySubtotal(cur, [a])
                      }
                      from={from}
                      to={to}
                      totals={rowTotals(a.id)}
                    />
                  ))}
                  <TotalsRow
                    label="Income subtotal"
                    renderCols={renderCols}
                    valueFor={(colId) => columnTotal(colId, incomeAccounts)}
                    subtotalFor={(cur) => currencySubtotal(cur, incomeAccounts)}
                  />
                  <SectionHeader
                    label="Operating expenses"
                    colSpan={renderCols.length + 2}
                  />
                  {expenseAccounts.map((a) => (
                    <MatrixRow
                      key={a.id}
                      account={a}
                      renderCols={renderCols}
                      cellAmount={cellAmount}
                      currencySubtotal={(cur) =>
                        currencySubtotal(cur, [a])
                      }
                      from={from}
                      to={to}
                      totals={rowTotals(a.id)}
                    />
                  ))}
                  <TotalsRow
                    label="Expense subtotal"
                    renderCols={renderCols}
                    valueFor={(colId) => columnTotal(colId, expenseAccounts)}
                    subtotalFor={(cur) => currencySubtotal(cur, expenseAccounts)}
                  />
                  <TotalsRow
                    label="Net (Income − Expense)"
                    renderCols={renderCols}
                    bold
                    valueFor={(colId) =>
                      columnTotal(colId, incomeAccounts) -
                      columnTotal(colId, expenseAccounts)
                    }
                    subtotalFor={(cur) =>
                      currencySubtotal(cur, incomeAccounts) -
                      currencySubtotal(cur, expenseAccounts)
                    }
                  />
                  {/* §6 — derived estimated income tax + after-tax net, per
                      currency. It sits on the subtotal columns rather than on
                      the Company column, where its old placement was a fiction:
                      the tax is computed on the whole currency group's net, not
                      on the company's own books. */}
                  {taxRatePct > 0 && (
                    <>
                      <tr className="border-b border-border bg-surface">
                        <td className="px-2 py-1 text-xs uppercase tracking-widest text-fg-muted">
                          Estimated income taxes ({taxRatePct}%)
                        </td>
                        {renderCols.map((c) => (
                          <td
                            key={renderColKey(c)}
                            className={
                              "px-2 py-1 text-right " +
                              (c.kind === "subtotal"
                                ? "border-l border-border bg-surface-high"
                                : "")
                            }
                          >
                            {c.kind === "subtotal" ? (
                              <CurrencyAmount
                                cents={-(estimatedTax[c.currency] ?? 0)}
                                currency={c.currency}
                                convert={false}
                              />
                            ) : (
                              <span className="text-fg-muted">—</span>
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right">
                          <MoneyTotal totals={negate(estimatedTax)} />
                        </td>
                      </tr>
                      <tr className="border-b border-border bg-surface">
                        <td className="px-2 py-1 text-xs font-bold uppercase tracking-widest text-fg-muted">
                          After-tax net
                        </td>
                        {renderCols.map((c) => (
                          <td
                            key={renderColKey(c)}
                            className={
                              "px-2 py-1 text-right font-bold " +
                              (c.kind === "subtotal"
                                ? "border-l border-border bg-surface-high"
                                : "text-fg-muted")
                            }
                          >
                            {c.kind === "subtotal" ? (
                              <CurrencyAmount
                                cents={afterTaxNet[c.currency] ?? 0}
                                currency={c.currency}
                                convert={false}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right font-bold">
                          <MoneyTotal totals={afterTaxNet} />
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {!loading && data && data.accounts.length > 0 && (
            <p className="mt-2 text-xs text-fg-muted">
              Each property column is shown in the currency that property books
              in and does not change when you switch the display currency. Only
              the <strong>Total</strong> column converts.
              {currencies.length > 1 && (
                <>
                  {" "}
                  The <strong>{data.orgDefaultCurrency} total</strong> column
                  includes the Company column, which is kept on the
                  organisation&apos;s own books — so the subtotals still add up
                  to the Total.
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Flip the sign of every bucket — for the "taxes reduce net" presentation. */
function negate(totals: MoneyByCurrency): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const [cur, cents] of Object.entries(totals)) {
    out[cur as PmCurrency] = -(cents ?? 0);
  }
  return out;
}

function MatrixRow({
  account,
  renderCols,
  cellAmount,
  currencySubtotal,
  from,
  to,
  totals,
}: {
  account: Account;
  renderCols: RenderCol[];
  cellAmount: (accountId: string, columnId: string) => number;
  currencySubtotal: (currency: PmCurrency) => number;
  from: string;
  to: string;
  totals: MoneyByCurrency;
}) {
  return (
    <tr className="border-b border-border/30">
      <td className="px-2 py-1 text-fg">{account.name}</td>
      {renderCols.map((c) => {
        if (c.kind === "subtotal") {
          const v = currencySubtotal(c.currency);
          return (
            <td
              key={renderColKey(c)}
              className="border-l border-border bg-surface-high/50 px-2 py-1 text-right font-medium"
            >
              {v === 0 ? (
                <span className="text-fg-muted">—</span>
              ) : (
                <CurrencyAmount
                  cents={v}
                  currency={c.currency}
                  convert={false}
                />
              )}
            </td>
          );
        }
        const v = cellAmount(account.id, c.id);
        const href = drillHref(account.id, c.id, from, to);
        return (
          <td key={renderColKey(c)} className="px-2 py-1 text-right">
            {v === 0 ? (
              <span className="text-fg-muted">—</span>
            ) : (
              <Link href={href} className="hover:underline">
                {/* Native: this cell belongs to one property, so converting it
                    would produce a figure matching nothing in the ledger. */}
                <CurrencyAmount
                  cents={v}
                  currency={c.currency}
                  convert={false}
                />
              </Link>
            )}
          </td>
        );
      })}
      <td className="px-2 py-1 text-right font-medium">
        <MoneyTotal totals={totals} />
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
  renderCols,
  valueFor,
  subtotalFor,
  bold = false,
}: {
  label: string;
  renderCols: RenderCol[];
  valueFor: (columnId: string) => number;
  subtotalFor: (currency: PmCurrency) => number;
  bold?: boolean;
}) {
  // The grand total accumulates from the REAL columns only. Reading it off
  // renderCols would count every property twice — once in its own column and
  // again in its currency's subtotal.
  const grand: MoneyByCurrency = {};
  for (const c of renderCols) {
    if (c.kind === "property") addMoney(grand, c.currency, valueFor(c.id));
  }
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
      {renderCols.map((c) => (
        <td
          key={renderColKey(c)}
          className={
            "px-2 py-1 text-right " +
            (bold ? "font-bold " : "") +
            (c.kind === "subtotal"
              ? "border-l border-border bg-surface-high font-bold"
              : "")
          }
        >
          <CurrencyAmount
            cents={
              c.kind === "subtotal" ? subtotalFor(c.currency) : valueFor(c.id)
            }
            currency={c.currency}
            convert={false}
          />
        </td>
      ))}
      <td className={"px-2 py-1 text-right " + (bold ? "font-bold" : "")}>
        <MoneyTotal totals={grand} />
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
