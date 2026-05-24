"use client";

// Stock detail (PDR §5.4): per-symbol research + the user's position context +
// a candlestick chart. Layout follows the reference design (Stitch mockup at
// design refernce/_stock_NASDAQ_NVDA.html, mirrored here without the inline
// design-tool markup):
//
//   1. Breadcrumb + page-level actions (Edit when held, Add otherwise).
//   2. Header card — identity (logo / ticker / exchange badge / name /
//      sector chips) on the left, large price block on the right.
//   3. Price chart with range selector (intraday on 1W).
//   4. Two-column footer — "Your Position" (left, only when held) and
//      "Quote details" (right) holding the OHLV+52-week range.
//
// The page is viewable for ANY valid symbol (research mode). Native listing
// currency is authoritative on this page (PDR §9 — single-symbol view stays
// honest about the listing currency rather than mixing in the USD/CAD toggle).
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Pencil, RefreshCw } from "lucide-react";
import { useStockDetail } from "@/lib/hooks/useStockDetail";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { TickerLogo } from "@/components/dashboard/TickerLogo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatNumber, formatPercent } from "@/lib/utils/formatNumber";
import type { Currency } from "@/lib/utils/convertCurrency";
import type { Exchange } from "@/lib/utils/portfolioMath";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils/cn";

const EXCHANGES: Exchange[] = ["NYSE", "NASDAQ", "TSX"];

function paramString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      <div className="mt-1 font-display text-sm font-bold text-fg tabular-nums">
        {children}
      </div>
    </div>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border bg-surface-high px-6 py-20 text-center">
      <p className="text-sm font-semibold text-fg">{message}</p>
      <Link href="/stock/portfolio" className="mt-5">
        <Button variant="secondary">
          <ArrowLeft className="h-4 w-4" />
          Back to portfolio
        </Button>
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function StockDetailPage() {
  const params = useParams();
  const rawExchange = paramString(params.exchange).toUpperCase();
  const ticker = decodeURIComponent(paramString(params.ticker))
    .trim()
    .toUpperCase();

  const exchange = EXCHANGES.find((e) => e === rawExchange);
  const validTicker = /^[A-Z0-9.\-]{1,12}$/.test(ticker);

  if (!exchange || !validTicker) {
    return (
      <NotFound message="That symbol path is invalid (expected /stock/NYSE|NASDAQ|TSX/TICKER)." />
    );
  }

  return <StockDetail exchange={exchange} ticker={ticker} />;
}

function StockDetail({
  exchange,
  ticker,
}: {
  exchange: Exchange;
  ticker: string;
}) {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const openAddPanel = useUiStore((s) => s.openAddPanel);
  const openEditPanel = useUiStore((s) => s.openEditPanel);
  const {
    quote,
    quoteStale,
    isLoadingQuote,
    quoteError,
    refetchQuote,
    profile,
    isLoadingProfile,
    position,
    range,
    setRange,
    candles,
    historyStale,
    isLoadingHistory,
    historyError,
    refetchHistory,
  } = useStockDetail(exchange, ticker);

  // Native listing currency: a held position is authoritative; otherwise infer
  // from the exchange (TSX → CAD, US exchanges → USD). PDR §9 — the detail
  // page shows a single symbol, so prices stay in their native currency.
  const nativeCurrency: Currency =
    position?.currency ?? (exchange === "TSX" ? "CAD" : "USD");

  const fc = (v: number | null | undefined, signed = false) =>
    formatCurrency(v, nativeCurrency, { format: numberFormat, signed });

  const dayUp = (quote?.dayChange ?? 0) >= 0;

  // Day change in absolute dollars for the user's position (their share count
  // × the per-share day change). Shown on the position card, hence native cur.
  const positionDayChange =
    position != null && quote?.dayChange != null
      ? position.quantity * quote.dayChange
      : null;

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb + page-level actions. The TopBar breadcrumb already shows
          the full path; this row mirrors the design reference's local crumb
          and right-aligned action cluster. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/stock/portfolio"
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Portfolio
        </Link>
        <div className="flex items-center gap-2">
          {position ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openEditPanel(position.id)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit position
            </Button>
          ) : null}
          <Button size="sm" onClick={() => openAddPanel()}>
            <Plus className="h-3.5 w-3.5" />
            Add to position
          </Button>
        </div>
      </div>

      {/* Header card — identity + headline price (no OHLV here; that lives in
          the Quote details card at the bottom, mirroring the reference). */}
      <Card>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <TickerLogo
              ticker={ticker}
              name={profile?.name}
              logo={profile?.logo}
              className="h-12 w-12"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl font-bold text-fg">
                  {ticker}
                </h1>
                <Badge variant="exchange">{exchange}</Badge>
                {position && <Badge variant="default">Held</Badge>}
                <span className="text-[11px] font-medium text-fg-muted">
                  Common stock · {nativeCurrency}
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-medium text-fg">
                {isLoadingProfile && !profile ? (
                  <Skeleton className="h-4 w-40" />
                ) : (
                  (profile?.name ?? "Company profile unavailable")
                )}
              </p>
              {(profile?.sector || profile?.industry) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile?.sector && (
                    <Badge variant="muted">{profile.sector}</Badge>
                  )}
                  {profile?.industry &&
                    profile.industry !== profile.sector && (
                      <Badge variant="muted">{profile.industry}</Badge>
                    )}
                </div>
              )}
            </div>
          </div>

          {/* Headline price block */}
          <div className="text-left sm:text-right">
            {isLoadingQuote && !quote ? (
              <>
                <Skeleton className="h-8 w-32 sm:ml-auto" />
                <Skeleton className="mt-2 h-4 w-24 sm:ml-auto" />
              </>
            ) : quote ? (
              <>
                <div className="font-display text-3xl font-bold text-fg tabular-nums">
                  {fc(quote.price)}
                </div>
                <div
                  className={cn(
                    "mt-1 text-sm font-bold tabular-nums",
                    dayUp ? "text-gain" : "text-loss",
                  )}
                >
                  {fc(quote.dayChange, true)} (
                  {formatPercent(quote.dayChangePct, {
                    format: numberFormat,
                  })}
                  ) today
                </div>
                {quoteStale && (
                  <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                    Last cached price
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span className="text-xs text-fg-muted">
                  {quoteError?.message ?? "Quote unavailable"}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={refetchQuote}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Price chart — full width, sits between the header and the per-card
          footer to mirror the design reference's "Price · {range}" section. */}
      <CandlestickChart
        candles={candles}
        range={range}
        onRangeChange={setRange}
        isLoading={isLoadingHistory}
        error={historyError?.message ?? null}
        onRetry={refetchHistory}
        stale={historyStale}
        avgBuyPrice={position?.avgBuyPrice ?? null}
        avgBuyCurrency={nativeCurrency}
        intraday={range === "1W"}
      />

      {/* Footer: position on the left (when held), quote details on the right.
          When the user doesn't hold the symbol, Quote details takes the full
          width so the layout doesn't feel empty. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-[18px]",
          position && "lg:grid-cols-2",
        )}
      >
        {position && (
          <Card>
            <CardHeader>
              <CardTitle>Your position</CardTitle>
              <span className="text-[11px] font-medium text-fg-muted">
                {nativeCurrency}
              </span>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label="Shares">
                  {formatNumber(position.quantity, {
                    format: numberFormat,
                    decimals: 0,
                  })}
                </Stat>
                <Stat label="Cost basis">
                  {fc(position.avgBuyPrice)}{" "}
                  <span className="text-[10.5px] font-medium text-fg-muted">
                    / share
                  </span>
                </Stat>
                <Stat label="Total cost">{fc(position.invested)}</Stat>
                <Stat label="Market value">
                  {position.currentValue == null
                    ? "—"
                    : fc(position.currentValue)}
                </Stat>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                    Unrealized P&amp;L
                  </div>
                  {position.pnl == null ? (
                    <div className="mt-1 font-display text-sm font-bold text-fg">
                      —
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "mt-1 font-display text-sm font-bold tabular-nums",
                        position.pnl >= 0 ? "text-gain" : "text-loss",
                      )}
                    >
                      {fc(position.pnl, true)}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                    Return
                  </div>
                  {position.pnlPct == null ? (
                    <div className="mt-1 font-display text-sm font-bold text-fg">
                      —
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "mt-1 font-display text-sm font-bold tabular-nums",
                        position.pnlPct >= 0 ? "text-gain" : "text-loss",
                      )}
                    >
                      {formatPercent(position.pnlPct, {
                        format: numberFormat,
                      })}
                    </div>
                  )}
                </div>
                <div className="min-w-0 sm:col-span-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                    Day change
                  </div>
                  {positionDayChange == null || quote == null ? (
                    <div className="mt-1 font-display text-sm font-bold text-fg">
                      —
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "mt-1 font-display text-sm font-bold tabular-nums",
                        dayUp ? "text-gain" : "text-loss",
                      )}
                    >
                      {fc(positionDayChange, true)}{" "}
                      <span className="text-xs">
                        (
                        {formatPercent(quote.dayChangePct, {
                          format: numberFormat,
                        })}
                        )
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quote details — OHLV + 52-week range. Always rendered (research
            mode), regardless of whether the user holds the symbol. */}
        <Card>
          <CardHeader>
            <CardTitle>Quote details</CardTitle>
            <span className="text-[11px] font-medium text-fg-muted">
              {nativeCurrency}
            </span>
          </CardHeader>
          <CardContent>
            {quote ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label="Open">{fc(quote.open)}</Stat>
                <Stat label="Day high">{fc(quote.high)}</Stat>
                <Stat label="Day low">{fc(quote.low)}</Stat>
                <Stat label="52w high">{fc(quote.high52w)}</Stat>
                <Stat label="52w low">{fc(quote.low52w)}</Stat>
                <Stat label="Volume">
                  {quote.volume == null
                    ? "—"
                    : formatNumber(quote.volume, {
                        format: numberFormat,
                        decimals: 0,
                        compact: true,
                      })}
                </Stat>
              </div>
            ) : (
              <p className="py-6 text-xs text-fg-muted">
                Quote details unavailable.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
