"use client";

// Index strip — S&P 500, NASDAQ, Dow, TSX Composite, USD/CAD (PDR §5.2).
// Each card shows the level/rate + day change %, color-coded. Index levels
// are points/rates, not portfolio money, so they are NOT currency-converted.
import { useIndicesQuery, type IndexQuote } from "@/lib/hooks/useDashboard";
import { formatNumber, formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { StatStripSkeleton } from "@/components/skeletons";
import { cn } from "@/lib/utils/cn";

// The five the dashboard surfaces, in order (PDR §5.2). getIndices also
// returns tsxv/vix — those are reserved for the Market page (Stage 11).
const DASHBOARD_KEYS = ["sp500", "nasdaq", "dow", "tsx", "usdcad"] as const;
const SHORT_LABEL: Record<string, string> = {
  sp500: "S&P 500",
  nasdaq: "NASDAQ",
  dow: "Dow Jones",
  tsx: "TSX Comp",
  usdcad: "USD/CAD",
};

function IndexCard({ q }: { q: IndexQuote }) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const up = q.percentChange >= 0;
  const isRate = q.key === "usdcad";
  return (
    <div className="min-w-[150px] rounded-md border border-border bg-surface p-3">
      <div className="mb-1 flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-tighter text-fg-muted">
          {SHORT_LABEL[q.key] ?? q.label}
        </span>
        <span
          className={cn(
            "text-[10px] font-bold",
            up ? "text-gain" : "text-loss",
          )}
        >
          {formatPercent(q.percentChange, { format: numberFormat })}
        </span>
      </div>
      <div className="font-display text-lg font-bold tracking-tight text-fg">
        {formatNumber(q.price, {
          format: numberFormat,
          decimals: isRate ? 4 : 2,
        })}
      </div>
    </div>
  );
}

export function IndexStrip() {
  const { data, isLoading, isError, refetch } = useIndicesQuery();

  if (isLoading) {
    return <StatStripSkeleton count={5} />;
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 text-xs text-fg-muted">
        <span>Market indices are temporarily unavailable.</span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="font-bold text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const byKey = new Map(data.data.map((q) => [q.key, q]));
  const cards = DASHBOARD_KEYS.map((k) => byKey.get(k)).filter(
    (q): q is IndexQuote => Boolean(q),
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((q) => (
          <IndexCard key={q.key} q={q} />
        ))}
      </div>
      {data.stale && (
        <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
          Showing last cached index data
        </p>
      )}
    </div>
  );
}
