"use client";

// Outstanding Balances widget — Dashboard (PROPERTY_TODO.md Phase 10).
// Top 5 leases by AR balance + total + count, served by
// /api/pm/outstanding-balances.
import * as React from "react";
import { WidgetCard } from "../WidgetCard";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";

interface Row {
  propertyId: string | null;
  unitId: string | null;
  leaseId: string | null;
  label: string;
  balanceCents: number;
}

interface Payload {
  totalCents: number;
  count: number;
  top: Row[];
}

export function OutstandingBalancesWidget() {
  const [data, setData] = React.useState<Payload | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/outstanding-balances")
      .then((r) => (r.ok ? r.json() : { totalCents: 0, count: 0, top: [] }))
      .then((d) => {
        if (!cancelled) setData(d as Payload);
      })
      .catch(() => {
        if (!cancelled) setData({ totalCents: 0, count: 0, top: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = data?.top ?? [];
  const total = data?.totalCents ?? 0;
  const count = data?.count ?? 0;

  return (
    <WidgetCard
      title="Outstanding Balances"
      viewAllHref="/properties/rentals/rent-roll"
      footer={count > 0 ? `Showing ${rows.length} of ${count}` : null}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-fg-muted">
          Total
        </span>
        <CurrencyAmount cents={total} className="text-2xl font-bold" />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No outstanding balances.</p>
      ) : (
        <ul className="flex flex-1 flex-col divide-y divide-border/60 text-sm">
          {rows.map((r, i) => (
            <li
              key={`${r.propertyId ?? "x"}-${r.unitId ?? "x"}-${i}`}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="truncate text-fg" title={r.label}>
                {r.label}
              </span>
              <CurrencyAmount
                cents={r.balanceCents}
                className="shrink-0 text-fg"
              />
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export default OutstandingBalancesWidget;
