"use client";

// Section 1 — Indices (PDR §5.5 §1). Expanded cards for the full seven:
// S&P 500, NASDAQ, Dow, TSX, TSX Venture, VIX, USD/CAD. Index levels are
// points / a rate, not portfolio money, so they are NOT currency-converted.
// Cards degrade gracefully if the plan gates a symbol (getIndices flat-maps
// out anything missing — Stage 4).
import { useMarketIndicesQuery, type IndexQuote } from "@/lib/hooks/useMarket";
import { formatNumber } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { StatStripSkeleton } from "@/components/skeletons";
import { SectionHeader, StaleNote, SectionError } from "@/components/market/shared";
import { cn } from "@/lib/utils/cn";

// Display order + short labels (PDR §5.5 §1).
const ORDER = [
  "sp500",
  "nasdaq",
  "dow",
  "tsx",
  "tsxv",
  "vix",
  "usdcad",
] as const;
const SHORT: Record<string, string> = {
  sp500: "S&P 500",
  nasdaq: "NASDAQ",
  dow: "Dow Jones",
  tsx: "TSX Composite",
  tsxv: "TSX Venture",
  vix: "VIX",
  usdcad: "USD/CAD",
};

function IndexCard({ q }: { q: IndexQuote }) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const up = q.percentChange >= 0;
  const isRate = q.key === "usdcad";
  return (
    <div className="rounded-md border border-border bg-surface-high p-4">
      <div className="text-[10px] font-bold uppercase tracking-tighter text-fg-muted">
        {SHORT[q.key] ?? q.label}
      </div>
      <div className="mt-2 font-display text-2xl font-bold tracking-tight text-fg">
        {formatNumber(q.price, {
          format: numberFormat,
          decimals: isRate ? 4 : 2,
        })}
      </div>
      <div
        className={cn(
          "mt-1 text-[11px] font-bold",
          up ? "text-gain" : "text-loss",
        )}
      >
        {formatNumber(q.change, {
          format: numberFormat,
          signed: true,
          decimals: isRate ? 4 : 2,
        })}{" "}
        ({formatNumber(q.percentChange, { format: numberFormat, signed: true })}
        %)
      </div>
    </div>
  );
}

export function MarketIndices() {
  const { data, isLoading, isError, refetch } = useMarketIndicesQuery();

  return (
    <section>
      <SectionHeader title="Indices" />
      {isLoading ? (
        <StatStripSkeleton count={7} className="md:grid-cols-4 lg:grid-cols-7" />
      ) : isError || !data ? (
        <SectionError label="Market indices" onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {ORDER.map((key) => {
              const q = data.data.find((d) => d.key === key);
              return q ? <IndexCard key={key} q={q} /> : null;
            })}
          </div>
          <StaleNote show={data.stale} />
        </>
      )}
    </section>
  );
}
