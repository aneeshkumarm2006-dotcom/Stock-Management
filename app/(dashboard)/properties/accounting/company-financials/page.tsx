// /properties/accounting/company-financials — Phase 9 read-only roll-up
// of the management company's books (PDR §3.27, §3.28). Hero cards +
// inline SVG bar chart + per-property table. Companion to the financials
// matrix at /properties/accounting/financials.
"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { CollectManagementFeesModal } from "@/components/pm/CollectManagementFeesModal";

interface CompanyFinancialsData {
  accountingMode: "cash" | "accrual";
  defaultCurrency: "USD" | "CAD";
  from: string;
  to: string;
  companyCashCents: number;
  unpaidBillsCents: number;
  overdueBillsCount: number;
  netIncomeCents: number;
  // §6 — additive reporting fields (rate defaults 0 ⇒ $0 tax line).
  totalRevenueCents: number;
  rentalRevenueCents: number;
  investmentRevenueCents: number;
  estimatedIncomeTaxRatePct: number;
  estimatedIncomeTaxCents: number;
  afterTaxNetCents: number;
  companyOnly: { incomeCents: number; expenseCents: number };
  propertyRollup: Array<{
    propertyId: string;
    propertyName: string;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
  }>;
  monthlyBalances: Array<{ month: string; netCents: number }>;
  // Year-over-year reporting fields.
  years: number[];
  annualBalances: Array<{
    year: number;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
  }>;
  propertyAnnual: Array<{
    propertyId: string;
    propertyName: string;
    byYear: Record<
      string,
      { incomeCents: number; expenseCents: number; netCents: number }
    >;
  }>;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Percentage change of `cur` vs `prev`. `positive: null` ⇒ no comparable prior
// year (first year, or a prior net of exactly 0).
function pctChange(
  cur: number,
  prev: number | null,
): { text: string; positive: boolean | null } {
  if (prev === null || prev === 0) return { text: "—", positive: null };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const sign = pct > 0 ? "+" : "";
  return { text: `${sign}${pct.toFixed(1)}%`, positive: pct >= 0 };
}

export default function CompanyFinancialsPage() {
  const { toast } = useToast();
  const today = new Date();
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const [from, setFrom] = React.useState(
    startOfYear.toISOString().slice(0, 10),
  );
  const [to, setTo] = React.useState(today.toISOString().slice(0, 10));
  const [data, setData] = React.useState<CompanyFinancialsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [collectOpen, setCollectOpen] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const currency = data?.defaultCurrency ?? "USD";

  // Year-over-year fetches its own multi-year window so the cards above stay
  // scoped to the user's chosen from/to range.
  const currentYear = today.getFullYear();
  const [yoySpan, setYoySpan] = React.useState(3);
  const [yoyData, setYoyData] = React.useState<CompanyFinancialsData | null>(
    null,
  );
  const [yoyLoading, setYoyLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from, to });
    const r = await fetch(`/api/pm/company-financials?${params.toString()}`);
    if (r.ok) setData((await r.json()) as CompanyFinancialsData);
    setLoading(false);
  }, [from, to]);

  const loadYoY = React.useCallback(async () => {
    setYoyLoading(true);
    const yoyFrom = `${currentYear - yoySpan + 1}-01-01`;
    const yoyTo = `${currentYear}-12-31`;
    const params = new URLSearchParams({ from: yoyFrom, to: yoyTo });
    const r = await fetch(`/api/pm/company-financials?${params.toString()}`);
    if (r.ok) setYoyData((await r.json()) as CompanyFinancialsData);
    setYoyLoading(false);
  }, [currentYear, yoySpan]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    loadYoY();
  }, [loadYoY]);

  const yoyAnnualByYear = React.useMemo(
    () =>
      new Map((yoyData?.annualBalances ?? []).map((a) => [a.year, a] as const)),
    [yoyData],
  );
  const yoyMonthlyGrid = React.useMemo(
    () =>
      new Map(
        (yoyData?.monthlyBalances ?? []).map(
          (m) => [m.month, m.netCents] as const,
        ),
      ),
    [yoyData],
  );

  async function toggleMode() {
    if (!data) return;
    setToggling(true);
    const nextMode = data.accountingMode === "cash" ? "accrual" : "cash";
    const r = await fetch("/api/pm/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountingMode: nextMode }),
    });
    setToggling(false);
    if (!r.ok) {
      toast({ title: "Failed to toggle accounting mode", variant: "error" });
      return;
    }
    await Promise.all([load(), loadYoY()]);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Company financials</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="cf-from">From</Label>
              <Input
                id="cf-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cf-to">To</Label>
              <Input
                id="cf-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            {data && (
              <Button
                size="sm"
                variant="outline"
                onClick={toggleMode}
                disabled={toggling}
              >
                {data.accountingMode === "cash" ? "Cash" : "Accrual"} basis ↔
              </Button>
            )}
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => setCollectOpen(true)}
            >
              Collect management fees
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <HeroCard
          label="Company cash"
          value={
            <CurrencyAmount cents={data?.companyCashCents ?? 0} currency={currency} />
          }
          subtitle="Sum of every isCompanyCash bank account"
        />
        <HeroCard
          label="Unpaid bills"
          value={
            <CurrencyAmount cents={data?.unpaidBillsCents ?? 0} currency={currency} />
          }
          subtitle={
            data?.overdueBillsCount
              ? `${data.overdueBillsCount} overdue`
              : "All bills current"
          }
        />
        <HeroCard
          label="Net income"
          value={
            <CurrencyAmount cents={data?.netIncomeCents ?? 0} currency={currency} />
          }
          subtitle={`${data?.accountingMode ?? "—"} basis · ${from} → ${to}`}
        />
      </div>

      {/* §6 — Revenue (rent + investment) and the derived estimated-income-tax
          line. Purely additive; the per-property roll-up below is untouched. */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue &amp; income tax</CardTitle>
        </CardHeader>
        <CardContent>
          {loading || !data ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : (
            <table className="w-full max-w-md text-sm">
              <tbody>
                <SummaryRow
                  label="Rental & other revenue"
                  cents={data.rentalRevenueCents}
                  currency={currency}
                />
                <SummaryRow
                  label="Investment revenue"
                  cents={data.investmentRevenueCents}
                  currency={currency}
                />
                <SummaryRow
                  label="Total revenue"
                  cents={data.totalRevenueCents}
                  currency={currency}
                  bold
                />
                <SummaryRow
                  label="Net income (pre-tax)"
                  cents={data.netIncomeCents}
                  currency={currency}
                />
                <SummaryRow
                  label={`Estimated income taxes (${data.estimatedIncomeTaxRatePct}%)`}
                  cents={-data.estimatedIncomeTaxCents}
                  currency={currency}
                />
                <SummaryRow
                  label="After-tax net income"
                  cents={data.afterTaxNetCents}
                  currency={currency}
                  bold
                />
              </tbody>
            </table>
          )}
          {data && data.estimatedIncomeTaxRatePct === 0 && (
            <p className="mt-2 text-xs text-fg-muted">
              Set an estimated income-tax rate under Accounting settings to
              populate the tax line.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly net</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : !data || data.monthlyBalances.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No posted journal entries in this period.
            </p>
          ) : (
            <MonthlyBarChart series={data.monthlyBalances} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Year over year</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="yoy-span" className="text-xs">
                Years to compare
              </Label>
              <Input
                id="yoy-span"
                type="number"
                min={2}
                max={10}
                className="w-20"
                value={yoySpan}
                onChange={(e) =>
                  setYoySpan(
                    Math.min(10, Math.max(2, Number(e.target.value) || 2)),
                  )
                }
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          {yoyLoading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : !yoyData || yoyData.years.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No posted journal entries in this period.
            </p>
          ) : (
            <>
              {/* Annual summary: income / expense / net + % change vs prior year */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-widest text-fg-muted">
                      <th className="py-2 text-left">Metric</th>
                      {yoyData.years.map((y) => (
                        <th key={y} className="py-2 text-right">
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/30">
                      <td className="py-1.5 text-fg-muted">Income</td>
                      {yoyData.years.map((y) => (
                        <td
                          key={y}
                          className="py-1.5 text-right tabular-nums"
                        >
                          <CurrencyAmount
                            cents={yoyAnnualByYear.get(y)?.incomeCents ?? 0}
                            currency={currency}
                          />
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-border/30">
                      <td className="py-1.5 text-fg-muted">Expenses</td>
                      {yoyData.years.map((y) => (
                        <td
                          key={y}
                          className="py-1.5 text-right tabular-nums"
                        >
                          <CurrencyAmount
                            cents={yoyAnnualByYear.get(y)?.expenseCents ?? 0}
                            currency={currency}
                          />
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-border">
                      <td className="py-1.5 font-bold">Net income</td>
                      {yoyData.years.map((y) => (
                        <td
                          key={y}
                          className="py-1.5 text-right tabular-nums font-bold"
                        >
                          <CurrencyAmount
                            cents={yoyAnnualByYear.get(y)?.netCents ?? 0}
                            currency={currency}
                          />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1.5 text-fg-muted">
                        Change vs prior year
                      </td>
                      {yoyData.years.map((y, i) => {
                        const cur = yoyAnnualByYear.get(y)?.netCents ?? 0;
                        const prevYear = i > 0 ? yoyData.years[i - 1] : undefined;
                        const prev =
                          prevYear === undefined
                            ? null
                            : yoyAnnualByYear.get(prevYear)?.netCents ?? 0;
                        const c = pctChange(cur, prev);
                        return (
                          <td
                            key={y}
                            className={
                              "py-1.5 text-right tabular-nums" +
                              (c.positive === null ? " text-fg-muted" : "")
                            }
                            style={
                              c.positive === null
                                ? undefined
                                : { color: c.positive ? "#16a34a" : "#dc2626" }
                            }
                          >
                            {c.text}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Side-by-side annual net bars */}
              <AnnualBarChart
                series={yoyData.annualBalances.map((a) => ({
                  year: a.year,
                  netCents: a.netCents,
                }))}
              />

              {/* Monthly net pivot: months × years */}
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-fg-muted">
                  Monthly net by year
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-widest text-fg-muted">
                        <th className="py-2 text-left">Month</th>
                        {yoyData.years.map((y) => (
                          <th key={y} className="py-2 text-right">
                            {y}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {MONTH_NAMES.map((mName, mIdx) => {
                        const mm = String(mIdx + 1).padStart(2, "0");
                        return (
                          <tr
                            key={mName}
                            className="border-b border-border/30"
                          >
                            <td className="py-1.5 text-fg-muted">{mName}</td>
                            {yoyData.years.map((y) => {
                              const cell = yoyMonthlyGrid.get(`${y}-${mm}`);
                              return (
                                <td
                                  key={y}
                                  className="py-1.5 text-right tabular-nums"
                                >
                                  {cell === undefined ? (
                                    <span className="text-fg-muted">—</span>
                                  ) : (
                                    <CurrencyAmount
                                      cents={cell}
                                      currency={currency}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      <tr className="border-t border-border">
                        <td className="py-1.5 font-bold">Total</td>
                        {yoyData.years.map((y) => (
                          <td
                            key={y}
                            className="py-1.5 text-right tabular-nums font-bold"
                          >
                            <CurrencyAmount
                              cents={yoyAnnualByYear.get(y)?.netCents ?? 0}
                              currency={currency}
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Per-property net pivot: property × years */}
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-fg-muted">
                  Net by property &amp; year
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-widest text-fg-muted">
                        <th className="py-2 text-left">Property</th>
                        {yoyData.years.map((y) => (
                          <th key={y} className="py-2 text-right">
                            {y}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {yoyData.propertyAnnual.map((p) => (
                        <tr
                          key={p.propertyId}
                          className="border-b border-border/40"
                        >
                          <td className="py-1.5">{p.propertyName}</td>
                          {yoyData.years.map((y) => (
                            <td
                              key={y}
                              className="py-1.5 text-right tabular-nums"
                            >
                              <CurrencyAmount
                                cents={p.byYear[String(y)]?.netCents ?? 0}
                                currency={currency}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="border-t border-border bg-bg-elevated">
                        <td className="py-1.5 font-bold">Total</td>
                        {yoyData.years.map((y) => (
                          <td
                            key={y}
                            className="py-1.5 text-right tabular-nums font-bold"
                          >
                            <CurrencyAmount
                              cents={yoyAnnualByYear.get(y)?.netCents ?? 0}
                              currency={currency}
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-property roll-up</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : !data || data.propertyRollup.length === 0 ? (
            <p className="text-sm text-fg-muted">No active properties.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-2">Property</th>
                  <th className="text-right">Income</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {data.propertyRollup.map((p) => (
                  <tr key={p.propertyId} className="border-b border-border/40">
                    <td className="py-1.5">{p.propertyName}</td>
                    <td className="text-right tabular-nums">
                      <CurrencyAmount cents={p.incomeCents} currency={currency} />
                    </td>
                    <td className="text-right tabular-nums">
                      <CurrencyAmount cents={p.expenseCents} currency={currency} />
                    </td>
                    <td className="text-right tabular-nums font-bold">
                      <CurrencyAmount cents={p.netCents} currency={currency} />
                    </td>
                  </tr>
                ))}
                {data.companyOnly &&
                  (data.companyOnly.incomeCents !== 0 ||
                    data.companyOnly.expenseCents !== 0) && (
                    <tr className="border-t border-border bg-bg-elevated">
                      <td className="py-1.5 font-bold">Company-scoped</td>
                      <td className="text-right tabular-nums">
                        <CurrencyAmount cents={data.companyOnly.incomeCents} currency={currency} />
                      </td>
                      <td className="text-right tabular-nums">
                        <CurrencyAmount cents={data.companyOnly.expenseCents} currency={currency} />
                      </td>
                      <td className="text-right tabular-nums font-bold">
                        <CurrencyAmount
                          currency={currency}
                          cents={
                            data.companyOnly.incomeCents -
                            data.companyOnly.expenseCents
                          }
                        />
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <CollectManagementFeesModal
        open={collectOpen}
        onClose={() => setCollectOpen(false)}
        onPosted={async () => {
          await Promise.all([load(), loadYoY()]);
        }}
      />
    </div>
  );
}

function SummaryRow({
  label,
  cents,
  currency,
  bold = false,
}: {
  label: string;
  cents: number;
  currency: "USD" | "CAD";
  bold?: boolean;
}) {
  return (
    <tr className={bold ? "border-t border-border" : "border-b border-border/30"}>
      <td
        className={
          "py-1.5 " + (bold ? "font-bold text-fg" : "text-fg-muted")
        }
      >
        {label}
      </td>
      <td
        className={
          "py-1.5 text-right tabular-nums " + (bold ? "font-bold" : "")
        }
      >
        <CurrencyAmount cents={cents} currency={currency} />
      </td>
    </tr>
  );
}

function HeroCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: React.ReactNode;
  subtitle: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-bold uppercase tracking-widest text-fg-muted">
          {label}
        </p>
        <p className="text-2xl tabular-nums">{value}</p>
        <p className="text-xs text-fg-muted">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function AnnualBarChart({
  series,
}: {
  series: Array<{ year: number; netCents: number }>;
}) {
  const max = Math.max(1, ...series.map((s) => Math.abs(s.netCents)));
  const barWidth = 48;
  const gap = 20;
  const chartHeight = 140;
  const baseline = chartHeight / 2;
  const width = series.length * (barWidth + gap) + gap;

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={chartHeight + 24}
        role="img"
        aria-label="Annual net income chart"
      >
        <line
          x1={0}
          y1={baseline}
          x2={width}
          y2={baseline}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
        {series.map((s, i) => {
          const x = gap + i * (barWidth + gap);
          const ratio = s.netCents / max;
          const h = Math.abs((ratio * chartHeight) / 2);
          const y = ratio >= 0 ? baseline - h : baseline;
          const fill = ratio >= 0 ? "#16a34a" : "#dc2626";
          return (
            <g key={s.year}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(1, h)}
                fill={fill}
              />
              <text
                x={x + barWidth / 2}
                y={chartHeight + 14}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
                opacity={0.7}
              >
                {s.year}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MonthlyBarChart({
  series,
}: {
  series: Array<{ month: string; netCents: number }>;
}) {
  const max = Math.max(
    1,
    ...series.map((s) => Math.abs(s.netCents)),
  );
  const barWidth = 30;
  const gap = 12;
  const chartHeight = 140;
  const baseline = chartHeight / 2;
  const width = series.length * (barWidth + gap) + gap;

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={chartHeight + 24}
        role="img"
        aria-label="Monthly net income chart"
      >
        <line
          x1={0}
          y1={baseline}
          x2={width}
          y2={baseline}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
        {series.map((s, i) => {
          const x = gap + i * (barWidth + gap);
          const ratio = s.netCents / max;
          const h = Math.abs((ratio * chartHeight) / 2);
          const y = ratio >= 0 ? baseline - h : baseline;
          const fill = ratio >= 0 ? "#16a34a" : "#dc2626";
          return (
            <g key={s.month}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(1, h)}
                fill={fill}
              />
              <text
                x={x + barWidth / 2}
                y={chartHeight + 14}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                opacity={0.7}
              >
                {s.month.slice(2)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
