"use client";

// API status panel (PDR §5.7): live usage bars per provider, driven by
// /api/usage → ApiUsage (Stage 4 getAllQuotaStatus). Refreshes every 30s.
//
// Honest free-tier framing, consistent with the Stage 4/5 reconciliations:
// - Twelve Data has a true daily credit cap (800/day) → a real ratio bar.
// - Finnhub is rate-limited 60 calls/MINUTE with no daily cap; ApiUsage only
//   records daily calls, so we show calls today + the 60/min ceiling, not a
//   fake daily ratio.
// - Exchange Rate is 1,500 calls/MONTH; the bar shows today vs the effective
//   daily share, with the monthly budget labelled.
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsStore } from "@/store/useSettingsStore";
import { formatNumber } from "@/lib/utils/formatNumber";
import {
  useUsageQuery,
  type ProviderUsage,
} from "@/lib/hooks/useSettings";

const NAME: Record<ProviderUsage["provider"], string> = {
  twelvedata: "Twelve Data",
  finnhub: "Finnhub",
  exchangerate: "Exchange Rate API",
};

function barColor(p: ProviderUsage): string {
  if (p.hard) return "bg-error";
  if (p.soft) return "bg-amber-500";
  return "bg-primary";
}

function UsageRow({ p }: { p: ProviderUsage }) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const fmt = (n: number) =>
    formatNumber(n, { decimals: 0, format: numberFormat });

  const hasDailyCap = p.limit != null && p.limit > 0;
  const pct = hasDailyCap
    ? Math.min(100, Math.round(p.ratio * 100))
    : null;

  const note =
    p.provider === "finnhub"
      ? `Rate limit ${p.callsPerMinute ?? 60} calls/min — tracked per day, not per minute.`
      : p.provider === "exchangerate"
        ? `${fmt(p.callsPerMonth ?? 1500)} calls/month budget — bar shows today vs the effective daily share.`
        : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-fg">{NAME[p.provider]}</p>
        <p className="text-xs tabular-nums text-fg-muted">
          {hasDailyCap ? (
            <>
              <span
                className={
                  p.hard
                    ? "text-loss"
                    : p.soft
                      ? "text-amber-500"
                      : "text-fg"
                }
              >
                {fmt(p.used)}
              </span>{" "}
              / {fmt(p.limit as number)} · {p.label}
            </>
          ) : (
            <>
              <span className="text-fg">{fmt(p.used)}</span> calls today ·{" "}
              {p.label}
            </>
          )}
        </p>
      </div>

      {hasDailyCap ? (
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-highest"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? 0}
          aria-label={`${NAME[p.provider]} usage`}
        >
          <div
            className={`h-full rounded-full transition-all ${barColor(p)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="mt-2 h-2 w-full rounded-full bg-surface-highest" />
      )}

      {note && (
        <p className="mt-1.5 text-[11px] text-fg-muted">{note}</p>
      )}
    </div>
  );
}

export function ApiStatusPanel() {
  const query = useUsageQuery();

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Status</CardTitle>
        <div className="flex items-center gap-2">
          {query.isFetching && (
            <RefreshCw className="h-3 w-3 animate-spin text-fg-muted" />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        ) : query.isError || !query.data ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-fg-muted">
              {query.error instanceof Error
                ? query.error.message
                : "Usage data unavailable."}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void query.refetch()}
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {query.data.providers.map((p) => (
              <UsageRow key={p.provider} p={p} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
