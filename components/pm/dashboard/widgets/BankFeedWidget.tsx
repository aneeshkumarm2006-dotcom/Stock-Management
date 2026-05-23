"use client";

// Bank Feed widget — Dashboard (PROPERTY_TODO.md Phase 10). Surfaces the
// count of Unmatched bank-feed rows that need to be reconciled. Empty-state
// copy matches PDR_dashboard.md §3 verbatim.
import * as React from "react";
import { WidgetCard } from "../WidgetCard";

interface BankFeedRow {
  id: string;
  status: string;
}

export function BankFeedWidget() {
  const [rows, setRows] = React.useState<BankFeedRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/bank-feed-transactions?status=Unmatched")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled) setRows(Array.isArray(d) ? (d as BankFeedRow[]) : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const count = rows?.length ?? 0;
  const empty = count === 0;
  return (
    <WidgetCard
      title="Bank Feed"
      viewAllHref="/properties/accounting/banking"
      footer={empty ? null : `${count} unmatched transaction${count === 1 ? "" : "s"}`}
    >
      {empty ? (
        <p className="text-sm text-fg-muted">
          There are no unmatched transactions at this time.
        </p>
      ) : (
        <div>
          <p className="text-3xl font-bold tabular-nums text-fg">{count}</p>
          <p className="text-sm text-fg-muted">
            Unmatched transactions waiting to be reconciled.
          </p>
        </div>
      )}
    </WidgetCard>
  );
}

export default BankFeedWidget;
