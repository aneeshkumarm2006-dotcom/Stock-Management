// /properties/accounting/balance-sheet — assets, liabilities and equity as at a
// date.
//
// Sits beside Financials rather than under Reports: the Reports page is scoped
// to custom and scheduled reports and its own copy points users to Accounting
// for ledger reporting.
//
// Two things this page is deliberately honest about:
//   1. It ALWAYS balances arithmetically (every journal entry is forced to
//      Σdebits === Σcredits), so a green "0.00" check is an integrity check for
//      orphaned lines, not a claim that the numbers are complete.
//   2. Opening balances were never entered. Until they are, the asset side is
//      broadly cash and receivables, and a mortgage will show as a growing
//      NEGATIVE liability because principal repayments debit it with no opening
//      credit to work against. The banner says exactly that rather than letting
//      it look like a bug.
"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { MoneyTotal } from "@/components/pm/MoneyTotal";
import type { MoneyByCurrency } from "@/lib/pm/moneyByCurrency";
import type { PmCurrency } from "@/types/pm";

interface BsAccount {
  id: string;
  name: string;
  type: string;
  active: boolean;
  totals: MoneyByCurrency;
}

interface BalanceSheet {
  asOf: string;
  orgDefaultCurrency: PmCurrency;
  currencies: PmCurrency[];
  assets: BsAccount[];
  liabilities: BsAccount[];
  equityAccounts: BsAccount[];
  retainedEarnings: MoneyByCurrency;
  totalAssets: MoneyByCurrency;
  totalLiabilities: MoneyByCurrency;
  totalEquity: MoneyByCurrency;
  balanceCheck: MoneyByCurrency;
  orphanLines: number;
  orphanTotals: MoneyByCurrency;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function endOfLastMonth(): string {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function lastYearEnd(): string {
  return `${new Date().getFullYear() - 1}-12-31`;
}

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = React.useState(todayIso);
  const [data, setData] = React.useState<BalanceSheet | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(
      `/api/pm/financials/balance-sheet?asOf=${encodeURIComponent(asOf)}`,
    );
    if (r.ok) setData((await r.json()) as BalanceSheet);
    setLoading(false);
  }, [asOf]);

  React.useEffect(() => {
    load();
  }, [load]);

  const currencies = data?.currencies ?? [];
  const drill = (accountId: string) =>
    `/properties/accounting/general-ledger?accountId=${accountId}&to=${asOf}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Balance sheet</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="bs-asof">As of</Label>
              <Input
                id="bs-asof"
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => setAsOf(todayIso())}>
              Today
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAsOf(endOfLastMonth())}
            >
              End of last month
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAsOf(lastYearEnd())}
            >
              Last year end
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-fg-muted">
            A point in time, not a period: this includes every posted entry
            dated on or before {asOf}, from the beginning of the ledger. Each
            currency is shown in its own column; the converted total is
            indicative only.
          </p>

          <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-fg">
            <span className="font-bold">Opening balances have not been entered.</span>{" "}
            This sheet reflects only what has been posted through this app.
            Property cost basis, accumulated depreciation, each mortgage&rsquo;s
            opening balance and prior-year retained earnings are all missing —
            so totals are correct as far as they go, but incomplete. A mortgage
            will read as a growing negative liability until its opening balance
            is posted.
          </div>

          {loading && <p className="text-sm text-fg-muted">Loading…</p>}

          {!loading && data && (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-widest text-fg-muted">
                  <tr>
                    <th className="px-2 py-2">Account</th>
                    {currencies.map((c) => (
                      <th key={c} className="px-2 py-2 text-right align-bottom">
                        {c}
                        <span className="block text-[10px] font-normal normal-case tracking-normal text-fg-muted">
                          native
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
                  <Section
                    label="Assets"
                    rows={data.assets}
                    currencies={currencies}
                    drill={drill}
                  />
                  <TotalRow
                    label="Total assets"
                    totals={data.totalAssets}
                    currencies={currencies}
                  />

                  <Section
                    label="Liabilities"
                    rows={data.liabilities}
                    currencies={currencies}
                    drill={drill}
                  />
                  <TotalRow
                    label="Total liabilities"
                    totals={data.totalLiabilities}
                    currencies={currencies}
                  />

                  <Section
                    label="Equity"
                    rows={data.equityAccounts}
                    currencies={currencies}
                    drill={drill}
                  />
                  {/* Not an account — see the route header. Named literally so
                      nobody goes looking for it in the chart of accounts. */}
                  <tr className="border-b border-border/30">
                    <td className="px-2 py-1 text-fg">
                      Retained earnings (computed — no closing entries)
                      <span className="ml-2 text-[11px] text-fg-muted">
                        cumulative income − expenses to {asOf}
                      </span>
                    </td>
                    {currencies.map((c) => (
                      <td key={c} className="px-2 py-1 text-right">
                        <CurrencyAmount
                          cents={data.retainedEarnings[c] ?? 0}
                          currency={c}
                          convert={false}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-medium">
                      <MoneyTotal totals={data.retainedEarnings} />
                    </td>
                  </tr>
                  <TotalRow
                    label="Total equity"
                    totals={data.totalEquity}
                    currencies={currencies}
                  />
                </tbody>
                <tfoot className="border-t-2 border-border">
                  <tr>
                    <td className="px-2 py-2 text-xs font-bold uppercase tracking-widest text-fg-muted">
                      Balance check — assets − (liabilities + equity)
                    </td>
                    {currencies.map((c) => {
                      const v = data.balanceCheck[c] ?? 0;
                      return (
                        <td
                          key={c}
                          className={
                            "px-2 py-2 text-right font-bold " +
                            (v === 0 ? "text-gain" : "text-loss")
                          }
                        >
                          <CurrencyAmount
                            cents={v}
                            currency={c}
                            convert={false}
                          />
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right text-fg-muted">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {!loading && data && (
            <p className="text-xs text-fg-muted">
              {data.orphanLines === 0 ? (
                <>
                  The balance check reads zero in every currency, so every
                  posted line is accounted for on this sheet. It is not a
                  statement that the opening balances above are complete.
                </>
              ) : (
                <span className="text-loss">
                  {data.orphanLines} journal line
                  {data.orphanLines === 1 ? "" : "s"} point at a chart-of-accounts
                  row that no longer exists and could not be classified, which is
                  why the balance check is not zero. Restore or re-map those
                  accounts to clear it.
                </span>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Section({
  label,
  rows,
  currencies,
  drill,
}: {
  label: string;
  rows: BsAccount[];
  currencies: PmCurrency[];
  drill: (accountId: string) => string;
}) {
  return (
    <>
      <tr className="bg-surface-high">
        <td
          colSpan={currencies.length + 2}
          className="px-2 py-1 text-xs font-bold uppercase tracking-widest text-fg-muted"
        >
          {label}
        </td>
      </tr>
      {rows.length === 0 && (
        <tr className="border-b border-border/30">
          <td
            colSpan={currencies.length + 2}
            className="px-2 py-1 text-fg-muted"
          >
            No balances.
          </td>
        </tr>
      )}
      {rows.map((a) => (
        <tr key={a.id} className="border-b border-border/30">
          <td className="px-2 py-1 text-fg">
            <Link href={drill(a.id)} className="hover:underline">
              {a.name}
            </Link>
            {!a.active && (
              <span className="ml-2 text-[11px] text-fg-muted">(inactive)</span>
            )}
          </td>
          {currencies.map((c) => (
            <td key={c} className="px-2 py-1 text-right">
              {(a.totals[c] ?? 0) === 0 ? (
                <span className="text-fg-muted">—</span>
              ) : (
                <CurrencyAmount
                  cents={a.totals[c] ?? 0}
                  currency={c}
                  convert={false}
                />
              )}
            </td>
          ))}
          <td className="px-2 py-1 text-right font-medium">
            <MoneyTotal totals={a.totals} />
          </td>
        </tr>
      ))}
    </>
  );
}

function TotalRow({
  label,
  totals,
  currencies,
}: {
  label: string;
  totals: MoneyByCurrency;
  currencies: PmCurrency[];
}) {
  return (
    <tr className="border-b border-border bg-surface">
      <td className="px-2 py-1 text-xs font-bold uppercase tracking-widest text-fg-muted">
        {label}
      </td>
      {currencies.map((c) => (
        <td key={c} className="px-2 py-1 text-right font-bold">
          <CurrencyAmount
            cents={totals[c] ?? 0}
            currency={c}
            convert={false}
          />
        </td>
      ))}
      <td className="px-2 py-1 text-right font-bold">
        <MoneyTotal totals={totals} />
      </td>
    </tr>
  );
}
