"use client";

// Section 3 — US Sector Heatmap (PDR §5.5 §3). 11 GICS sector tiles, each
// background color-graded by the SPDR sector ETF's day % change on the
// divergent scale from tokens.md (#7F1D1D negative → #1E2533 neutral →
// #14532D positive). Custom Tailwind grid; the per-tile color is computed
// inline since the scale is continuous (Tailwind can't express it statically).
import { useHeatmapQuery } from "@/lib/hooks/useMarket";
import { formatNumber } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader, StaleNote, SectionError } from "@/components/market/shared";

// Divergent stops (tokens.md §Sector heatmap divergent scale).
const NEG = [127, 29, 29] as const; // #7F1D1D
const MID = [30, 37, 51] as const; // #1E2533
const POS = [20, 83, 45] as const; // #14532D
// % change that saturates a tile to the strong stop.
const CLAMP = 3;

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Background color for a sector tile from its day % change. */
function tileColor(pct: number): string {
  const t = Math.max(-1, Math.min(1, pct / CLAMP));
  const [r, g, b] =
    t >= 0
      ? ([
          lerp(MID[0], POS[0], t),
          lerp(MID[1], POS[1], t),
          lerp(MID[2], POS[2], t),
        ] as const)
      : ([
          lerp(MID[0], NEG[0], -t),
          lerp(MID[1], NEG[1], -t),
          lerp(MID[2], NEG[2], -t),
        ] as const);
  return `rgb(${r}, ${g}, ${b})`;
}

export function SectorHeatmap() {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const { data, isLoading, isError, refetch } = useHeatmapQuery();

  return (
    <section>
      <SectionHeader title="US Sector Heatmap" note="GICS sectors · SPDR ETF day change" />
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 11 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-md" />
          ))}
        </div>
      ) : isError || !data ? (
        <SectionError label="Sector heatmap" onRetry={() => void refetch()} />
      ) : (
        <>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
            role="list"
            aria-label="US sector performance heatmap"
          >
            {data.data.map((s) => {
              const up = s.percentChange >= 0;
              return (
                <div
                  key={s.etf}
                  role="listitem"
                  className="flex flex-col justify-between rounded-md border border-border/60 p-3"
                  style={{ backgroundColor: tileColor(s.percentChange) }}
                  title={`${s.sector} (${s.etf})`}
                >
                  <div className="text-[10px] font-bold uppercase leading-tight tracking-tight text-white/90">
                    {s.sector}
                  </div>
                  <div className="mt-2">
                    <span className="font-display text-base font-bold text-white">
                      {formatNumber(s.percentChange, {
                        format: numberFormat,
                        signed: true,
                      })}
                      %
                    </span>
                    <span className="ml-1.5 text-[10px] font-medium text-white/70">
                      {s.etf}
                    </span>
                  </div>
                  <span className="sr-only">{up ? "up" : "down"}</span>
                </div>
              );
            })}
          </div>
          <StaleNote show={data.stale} />
        </>
      )}
    </section>
  );
}
