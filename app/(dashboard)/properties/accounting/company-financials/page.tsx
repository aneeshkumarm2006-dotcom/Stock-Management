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
  from: string;
  to: string;
  companyCashCents: number;
  unpaidBillsCents: number;
  overdueBillsCount: number;
  netIncomeCents: number;
  companyOnly: { incomeCents: number; expenseCents: number };
  propertyRollup: Array<{
    propertyId: string;
    propertyName: string;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
  }>;
  monthlyBalances: Array<{ month: string; netCents: number }>;
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

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from, to });
    const r = await fetch(`/api/pm/company-financials?${params.toString()}`);
    if (r.ok) setData((await r.json()) as CompanyFinancialsData);
    setLoading(false);
  }, [from, to]);

  React.useEffect(() => {
    load();
  }, [load]);

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
    await load();
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
            <CurrencyAmount cents={data?.companyCashCents ?? 0} />
          }
          subtitle="Sum of every isCompanyCash bank account"
        />
        <HeroCard
          label="Unpaid bills"
          value={
            <CurrencyAmount cents={data?.unpaidBillsCents ?? 0} />
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
            <CurrencyAmount cents={data?.netIncomeCents ?? 0} />
          }
          subtitle={`${data?.accountingMode ?? "—"} basis · ${from} → ${to}`}
        />
      </div>

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
                      <CurrencyAmount cents={p.incomeCents} />
                    </td>
                    <td className="text-right tabular-nums">
                      <CurrencyAmount cents={p.expenseCents} />
                    </td>
                    <td className="text-right tabular-nums font-bold">
                      <CurrencyAmount cents={p.netCents} />
                    </td>
                  </tr>
                ))}
                {data.companyOnly &&
                  (data.companyOnly.incomeCents !== 0 ||
                    data.companyOnly.expenseCents !== 0) && (
                    <tr className="border-t border-border bg-bg-elevated">
                      <td className="py-1.5 font-bold">Company-scoped</td>
                      <td className="text-right tabular-nums">
                        <CurrencyAmount cents={data.companyOnly.incomeCents} />
                      </td>
                      <td className="text-right tabular-nums">
                        <CurrencyAmount cents={data.companyOnly.expenseCents} />
                      </td>
                      <td className="text-right tabular-nums font-bold">
                        <CurrencyAmount
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
          await load();
        }}
      />
    </div>
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
