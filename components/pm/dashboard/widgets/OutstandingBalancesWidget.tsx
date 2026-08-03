"use client";

// Outstanding Balances widget — Dashboard (PROPERTY_TODO.md Phase 10).
// Overall total + a per-country breakdown (Canada vs United States), each
// country with its own subtotal and its top leases by AR balance. Served by
// /api/pm/outstanding-balances. Falls back to a single merged list when the
// API returns no `groups` (backward-compat).
import * as React from "react";
import { WidgetCard } from "../WidgetCard";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { MoneyTotal } from "@/components/pm/MoneyTotal";
import type { MoneyByCurrency } from "@/lib/pm/moneyByCurrency";
import type { PmCurrency } from "@/types/pm";

interface Row {
  propertyId: string | null;
  unitId: string | null;
  leaseId: string | null;
  label: string;
  balanceCents: number;
  /** Currency this row's balance is denominated in. */
  currency?: PmCurrency;
}

interface CountryGroup {
  country: string;
  totals: MoneyByCurrency;
  count: number;
  top: Row[];
}

interface Payload {
  /** Per-currency buckets — a country can hold properties booking in either. */
  totals: MoneyByCurrency;
  count: number;
  top: Row[];
  groups?: CountryGroup[];
}

const EMPTY: Payload = { totals: {}, count: 0, top: [], groups: [] };

function BalanceRow({ r, i }: { r: Row; i: number }) {
  return (
    <li
      key={`${r.propertyId ?? "x"}-${r.unitId ?? "x"}-${i}`}
      className="flex items-center justify-between gap-3 py-2"
    >
      <span className="truncate text-fg" title={r.label}>
        {r.label}
      </span>
      {/* Each row converts from its OWN property's currency. */}
      <CurrencyAmount
        cents={r.balanceCents}
        currency={r.currency}
        className="shrink-0 text-fg"
      />
    </li>
  );
}

export function OutstandingBalancesWidget() {
  const [data, setData] = React.useState<Payload | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/outstanding-balances")
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((d) => {
        if (!cancelled) setData(d as Payload);
      })
      .catch(() => {
        if (!cancelled) setData(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = data?.top ?? [];
  const totals = data?.totals;
  const count = data?.count ?? 0;
  const groups = (data?.groups ?? []).filter((g) => g.top.length > 0);
  const hasGroups = groups.length > 0;

  return (
    <WidgetCard
      title="Outstanding Balances"
      viewAllHref="/properties/rentals/rent-roll"
      footer={
        !hasGroups && count > 0 ? `Showing ${rows.length} of ${count}` : null
      }
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-fg-muted">
          Total
        </span>
        <MoneyTotal totals={totals} className="text-2xl font-bold" />
      </div>

      {count === 0 ? (
        <p className="text-sm text-fg-muted">No outstanding balances.</p>
      ) : hasGroups ? (
        <div className="mt-2 flex flex-1 flex-col gap-4">
          {groups.map((g) => (
            <div key={g.country}>
              <div className="flex items-baseline justify-between border-t border-border/60 pt-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-fg">
                  {g.country}
                </span>
                <MoneyTotal
                  totals={g.totals}
                  className="text-sm font-semibold text-fg"
                />
              </div>
              <ul className="flex flex-col divide-y divide-border/60 text-sm">
                {g.top.map((r, i) => (
                  <BalanceRow key={`${g.country}-${i}`} r={r} i={i} />
                ))}
              </ul>
              <div className="pt-1 text-right text-xs text-fg-muted">
                Showing {g.top.length} of {g.count}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex flex-1 flex-col divide-y divide-border/60 text-sm">
          {rows.map((r, i) => (
            <BalanceRow key={`${r.propertyId ?? "x"}-${i}`} r={r} i={i} />
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export default OutstandingBalancesWidget;
