"use client";

// Recent Activity widget — Dashboard (PROPERTY_TODO.md Phase 10). Lazy-loaded
// per PDR §8.4: the widget shows a CTA until the user clicks "Load recent
// activity", then fetches and renders the trailing org-wide activity stream.
// Date-range dropdown filters client-side after fetch.
import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { WidgetCard } from "../WidgetCard";

type RangeKey = "7d" | "30d" | "90d";

interface Entry {
  id: string;
  parentType: string;
  parentId: string;
  eventType: string;
  actorUserId: string;
  createdAt: string;
}

const RANGE_LABELS: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const RANGE_MS: Record<RangeKey, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

export function RecentActivityWidget() {
  const [range, setRange] = React.useState<RangeKey>("7d");
  const [entries, setEntries] = React.useState<Entry[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch("/api/pm/activity?limit=50")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        setEntries(Array.isArray(d) ? (d as Entry[]) : []);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = React.useMemo(() => {
    if (!entries) return [];
    const cutoff = Date.now() - RANGE_MS[range];
    return entries.filter((e) => new Date(e.createdAt).getTime() >= cutoff);
  }, [entries, range]);

  return (
    <WidgetCard
      title="Recent Activity"
      headerExtra={
        entries != null && (
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
            className="rounded border border-border bg-surface-low px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-fg"
            aria-label="Activity date range"
          >
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </select>
        )
      }
      footer={
        entries != null
          ? `Showing ${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}`
          : null
      }
    >
      {entries == null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm font-semibold text-fg">Ready for an update?</p>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-primary-fg transition-colors hover:bg-primary-container disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load recent activity"}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-fg-muted">No activity in this window.</p>
      ) : (
        <ul className="flex flex-1 flex-col divide-y divide-border/60 text-sm">
          {filtered.slice(0, 5).map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-3 py-2"
            >
              <span className="truncate text-fg">{e.eventType}</span>
              <span className="shrink-0 text-xs text-fg-muted">
                {formatDistanceToNowStrict(new Date(e.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export default RecentActivityWidget;
