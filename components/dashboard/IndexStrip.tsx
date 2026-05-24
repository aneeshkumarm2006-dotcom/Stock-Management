"use client";

// Index strip — six market cards in a 3-col grid mirroring the design
// reference (_stock_dashboard.html § cols-3): S&P 500, Nasdaq, Dow, Canada
// (TSX proxy EWC), VIX, USD/CAD. Each card shows label + value + signed
// change pill; index levels are points/rates and are NOT
// currency-converted.
import { useIndicesQuery, type IndexQuote } from "@/lib/hooks/useDashboard";
import { formatNumber, formatPercent } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { StatStripSkeleton } from "@/components/skeletons";
import { cn } from "@/lib/utils/cn";

const DASHBOARD_KEYS = [
  "sp500",
  "nasdaq",
  "dow",
  "tsx",
  "vix",
  "usdcad",
] as const;

const SHORT_LABEL: Record<string, string> = {
  sp500: "S&P 500",
  nasdaq: "Nasdaq",
  dow: "Dow",
  tsx: "TSX",
  vix: "VIX",
  usdcad: "USD/CAD",
};

function IndexCard({ q }: { q: IndexQuote }) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const up = q.percentChange >= 0;
  const isRate = q.key === "usdcad";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-[14px]">
      <div className="flex min-w-0 flex-col gap-[2px]">
        <div className="text-[11.5px] font-medium text-fg-muted">
          {SHORT_LABEL[q.key] ?? q.label}
        </div>
        <div className="text-[20px] font-[650] leading-[1.1] tracking-[-0.018em] text-fg tabular-nums">
          {formatNumber(q.price, {
            format: numberFormat,
            decimals: isRate ? 4 : 2,
          })}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-md px-[8px] py-[3px] text-[11px] font-semibold tabular-nums",
          up
            ? "bg-gain/10 text-gain"
            : "bg-loss/10 text-loss",
        )}
      >
        {up ? "+" : ""}
        {formatPercent(q.percentChange, { format: numberFormat })}
      </span>
    </div>
  );
}

export function IndexStrip() {
  const { data, isLoading, isError, refetch } = useIndicesQuery();

  if (isLoading) {
    return <StatStripSkeleton count={6} />;
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-[12px] text-fg-muted">
        <span>Market indices are temporarily unavailable.</span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="font-semibold text-primary hover:underline"
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((q) => (
          <IndexCard key={q.key} q={q} />
        ))}
      </div>
      {data.stale && (
        <p className="mt-1.5 text-[11px] font-medium text-fg-muted">
          Showing last cached index data
        </p>
      )}
    </div>
  );
}
