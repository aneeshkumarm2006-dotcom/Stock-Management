"use client";

// Shared chrome for the Market Insights sections (PDR §5.5, §11): a titled
// section header with an optional "free-tier" note, a stale-data indicator,
// an error + retry control, and a compact mover-list row used by Gainers/
// Losers, Most Active and 52-week Highs/Lows. Built to the "Portfolio Dark"
// design system (tokens.md) — no dedicated Stitch mockup per project scope.
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { MoverRow } from "@/lib/hooks/useMarket";
import { formatNumber } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cn } from "@/lib/utils/cn";

export function SectionHeader({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-fg">
          {title}
        </h2>
        {note && (
          <p className="mt-0.5 text-[10px] font-medium text-fg-muted">
            {note}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/** Subtle "showing last cached data" indicator (PDR §11). */
export function StaleNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
      Showing last cached market data
    </p>
  );
}

/** Inline error + retry control for a section with no cached fallback. */
export function SectionError({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-6 text-xs text-fg-muted">
      <span>{label} is temporarily unavailable.</span>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 font-bold text-primary hover:underline"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-low px-4 py-8 text-center text-[11px] text-fg-muted">
      {children}
    </div>
  );
}

/** One symbol row: ticker + name on the left, price + % change on the right.
 *  `metric` swaps the secondary right-hand figure (volume for Most Active). */
export function MoverRowItem({
  row,
  metric = "percent",
}: {
  row: MoverRow;
  metric?: "percent" | "volume";
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const up = row.percentChange >= 0;
  return (
    <Link
      href={`/stock/NASDAQ/${encodeURIComponent(row.symbol)}`}
      className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-highest"
    >
      <div className="min-w-0">
        <div className="text-xs font-bold text-fg">{row.symbol}</div>
        <div className="truncate text-[10px] text-fg-muted">{row.name}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-display text-xs font-bold text-fg">
          {formatNumber(row.price, { format: numberFormat, decimals: 2 })}
        </div>
        {metric === "volume" ? (
          <div className="text-[10px] font-medium text-fg-muted">
            Vol {formatNumber(row.volume, { format: numberFormat, compact: true, decimals: 0 })}
          </div>
        ) : (
          <div
            className={cn(
              "text-[10px] font-bold",
              up ? "text-gain" : "text-loss",
            )}
          >
            {formatNumber(row.percentChange, {
              format: numberFormat,
              signed: true,
            })}
            %
          </div>
        )}
      </div>
    </Link>
  );
}

/** A bordered card wrapping a titled, scrollable list of mover rows. */
export function MoverListCard({
  title,
  rows,
  metric,
  emptyLabel,
  className,
}: {
  title: string;
  rows: MoverRow[];
  metric?: "percent" | "volume";
  emptyLabel: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-surface-high",
        className,
      )}
    >
      <div className="border-b border-border px-4 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-fg-muted">
          {title}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[11px] text-fg-muted">
          {emptyLabel}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <MoverRowItem key={r.symbol} row={r} metric={metric} />
          ))}
        </div>
      )}
    </div>
  );
}
