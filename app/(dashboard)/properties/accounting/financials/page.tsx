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
  accounts: Account[];
  columns: Column[];
  cells: Cell[];
}

export default function FinancialsPage() {
  const { toast } = useToast();
  const today = new Date();
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const [from, setFrom] = React.useState<string>(
    startOfYear.toISOString().slice(0, 10),
  );
  const [to, setTo] = React.useState<string>(today.toISOString().slice(0, 10));
  const [data, setData] = React.useState<Matrix | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [toggling, setToggling] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const r = await fetch(`/api/pm/financials/matrix?${params.toString()}`);
    if (r.ok) setData((await r.json()) as Matrix);
    setLoading(false);
  }, [from, to]);

  React.useEffect(() => {
    load();
  }, [load]);

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
