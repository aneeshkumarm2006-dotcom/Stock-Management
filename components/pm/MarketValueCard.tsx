// Property market value (income-capitalization) — Area 2.
//
// Market Value = (annual income − annual expenses) / cap rate. Income and
// expenses AUTO-FILL from the property's General Ledger (trailing 12 months via
// /api/pm/financials/matrix) but all three inputs are user-editable: type a
// number to override that input, clear it to fall back to the ledger figure.
// Market value is derived live and never stored — only the three inputs persist
// on the Property (dollars for money, percent for cap rate).
"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { fromCents } from "@/lib/pm/currency";
import {
  computeMarketValue,
  glIncomeExpenseCentsByProperty,
  trailing12moRange,
  type MatrixLike,
} from "@/lib/pm/valuation";

interface Props {
  propertyId: string;
  /** Persisted overrides (dollars) + cap rate (percent); null = use ledger. */
  incomeOverride: number | null;
  expenseOverride: number | null;
  capRatePct: number | null;
  canEdit?: boolean;
  onSaved: () => Promise<void> | void;
}

function parseNum(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function MarketValueCard({
  propertyId,
  incomeOverride,
  expenseOverride,
  capRatePct,
  canEdit = true,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [glIncome, setGlIncome] = React.useState<number | null>(null); // dollars
  const [glExpense, setGlExpense] = React.useState<number | null>(null);
  const [loadingGl, setLoadingGl] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // Inputs hold the OVERRIDE only (empty string = "track the ledger"). The
  // ledger figure shows as placeholder + helper text so the user sees the
  // baseline they're adjusting.
  const [incomeInput, setIncomeInput] = React.useState(
    incomeOverride == null ? "" : String(incomeOverride),
  );
  const [expenseInput, setExpenseInput] = React.useState(
    expenseOverride == null ? "" : String(expenseOverride),
  );
  const [capRateInput, setCapRateInput] = React.useState(
    capRatePct == null ? "" : String(capRatePct),
  );

  // Re-sync inputs when the persisted values change under us (post-save refetch).
  React.useEffect(() => {
    setIncomeInput(incomeOverride == null ? "" : String(incomeOverride));
  }, [incomeOverride]);
  React.useEffect(() => {
    setExpenseInput(expenseOverride == null ? "" : String(expenseOverride));
  }, [expenseOverride]);
  React.useEffect(() => {
    setCapRateInput(capRatePct == null ? "" : String(capRatePct));
  }, [capRatePct]);

  React.useEffect(() => {
    let cancelled = false;
    const { from, to } = trailing12moRange();
    setLoadingGl(true);
    fetch(`/api/pm/financials/matrix?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MatrixLike | null) => {
        if (cancelled) return;
        if (!data) {
          setLoadingGl(false);
          return;
        }
        const byProp = glIncomeExpenseCentsByProperty(data);
        const mine = byProp.get(propertyId) ?? { incomeCents: 0, expenseCents: 0 };
        setGlIncome(fromCents(mine.incomeCents));
        setGlExpense(fromCents(mine.expenseCents));
        setLoadingGl(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingGl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const incomeOv = parseNum(incomeInput);
  const expenseOv = parseNum(expenseInput);
  const capRate = parseNum(capRateInput);
  const { income, expense, noi, marketValue } = computeMarketValue({
    incomeOverride: incomeOv,
    expenseOverride: expenseOv,
    capRatePct: capRate,
    glIncome: glIncome ?? 0,
    glExpense: glExpense ?? 0,
  });

  const dirty =
    incomeInput !== (incomeOverride == null ? "" : String(incomeOverride)) ||
    expenseInput !== (expenseOverride == null ? "" : String(expenseOverride)) ||
    capRateInput !== (capRatePct == null ? "" : String(capRatePct));

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/pm/properties/${propertyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        valuationAnnualIncomeOverride: incomeOv,
        valuationAnnualExpenseOverride: expenseOv,
        valuationCapRatePct: capRate,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Save failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Market value updated", variant: "success" });
    await onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market value</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Derived headline */}
        <div className="rounded border border-border bg-surface-high/40 p-4">
          <div className="text-xs uppercase tracking-widest text-fg-muted">
            Estimated market value
          </div>
          <div className="mt-1 text-2xl font-bold text-fg">
            {marketValue == null ? (
              <span className="text-base font-normal text-fg-muted">
                Set a cap rate to compute a value
              </span>
            ) : (
              <CurrencyAmount value={marketValue} />
            )}
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            Net operating income <CurrencyAmount value={noi} /> ={" "}
            <CurrencyAmount value={income} /> income −{" "}
            <CurrencyAmount value={expense} /> expenses
            {capRate && capRate > 0 ? `, ÷ ${capRate}% cap rate` : ""}
          </div>
        </div>

        {/* Editable inputs */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="mv-income">Annual income ($)</Label>
            <Input
              id="mv-income"
              type="number"
              min={0}
              step="0.01"
              value={incomeInput}
              placeholder={glIncome == null ? "" : String(glIncome)}
              disabled={!canEdit}
              onChange={(e) => setIncomeInput(e.target.value)}
            />
            <p className="text-xs text-fg-muted">
              {loadingGl
                ? "Loading ledger…"
                : incomeOv != null
                  ? `Override · ledger ${fmtDollars(glIncome)}`
                  : `From ledger: ${fmtDollars(glIncome)}`}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mv-expense">Annual expenses ($)</Label>
            <Input
              id="mv-expense"
              type="number"
              min={0}
              step="0.01"
              value={expenseInput}
              placeholder={glExpense == null ? "" : String(glExpense)}
              disabled={!canEdit}
              onChange={(e) => setExpenseInput(e.target.value)}
            />
            <p className="text-xs text-fg-muted">
              {loadingGl
                ? "Loading ledger…"
                : expenseOv != null
                  ? `Override · ledger ${fmtDollars(glExpense)}`
                  : `From ledger: ${fmtDollars(glExpense)}`}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mv-caprate">Cap rate (%)</Label>
            <Input
              id="mv-caprate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={capRateInput}
              placeholder="e.g. 6.5"
              disabled={!canEdit}
              onChange={(e) => setCapRateInput(e.target.value)}
            />
            <p className="text-xs text-fg-muted">
              Annual net income ÷ cap rate = value
            </p>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs italic text-fg-muted">
              Income &amp; expenses default to the trailing-12-month ledger. Type
              to override; clear a field to track the ledger again.
            </p>
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function fmtDollars(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default MarketValueCard;
