"use client";

// Stock detail (PDR §5.4): per-symbol research + the user's position context +
// a candlestick chart. The page is viewable for ANY valid symbol; the "Your
// Position" card only renders when the signed-in user holds it. Built to the
// "Portfolio Dark" design system (no dedicated Stitch mockup — see
// site/design/README.md): shared card / badge / ticker-logo vocabulary,
// green/red P&L semantics, native-currency price columns (PDR §9).
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useStockDetail } from "@/lib/hooks/useStockDetail";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { TickerLogo } from "@/components/dashboard/TickerLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatNumber, formatPercent } from "@/lib/utils/formatNumber";
import type { Currency } from "@/lib/utils/convertCurrency";
import type { Exchange } from "@/lib/utils/portfolioMath";
import { useSettingsStore } from "@/store/useSettingsStore";
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
      <div className="mt-1 font-display text-sm font-bold text-fg">
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
  // from the exchange (TSX → CAD, US exchanges → USD). PDR §9 — the detail page
  // shows a single symbol, so prices stay in their native currency.
  const nativeCurrency: Currency =
    position?.currency ?? (exchange === "TSX" ? "CAD" : "USD");

  const fc = (v: number | null | undefined, signed = false) =>
    formatCurrency(v, nativeCurrency, { format: numberFormat, signed });

  const dayUp = (quote?.dayChange ?? 0) >= 0;

  return (
    <div className="space-y-6">
      <Link
        href="/stock/portfolio"
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Portfolio
      </Link>

      {/* Header — logo, name, ticker, exchange badge, sector, industry */}
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <TickerLogo
              ticker={ticker}
              name={profile?.name}
              logo={profile?.logo}
              className="h-12 w-12"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-xl font-bold text-fg">
                  {ticker}
                </h1>
                <Badge variant="exchange">{exchange}</Badge>
                {position && <Badge variant="default">Held</Badge>}
              </div>
              <p className="mt-0.5 truncate text-sm text-fg-muted">
                {isLoadingProfile && !profile ? (
                  <Skeleton className="h-4 w-40" />
                ) : (
                  profile?.name ?? "Company profile unavailable"
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

          {/* Price block */}
          <div className="text-left sm:text-right">
            {isLoadingQuote && !quote ? (
              <>
                <Skeleton className="h-8 w-32 sm:ml-auto" />
                <Skeleton className="mt-2 h-4 w-24 sm:ml-auto" />
              </>
            ) : quote ? (
              <>
                <div className="font-display text-3xl font-bold text-fg">
                  {fc(quote.price)}
                </div>
                <div
                  className={cn(
                    "mt-1 text-sm font-bold",
                    dayUp ? "text-gain" : "text-loss",
                  )}
                >
                  {fc(quote.dayChange, true)} (
                  {formatPercent(quote.dayChangePct, {
                    format: numberFormat,
                  })}
                  )
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

        {/* OHLV + 52-week range */}
        {quote && (
          <div className="grid grid-cols-2 gap-4 border-t border-border p-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Open">{fc(quote.open)}</Stat>
            <Stat label="Day High">{fc(quote.high)}</Stat>
            <Stat label="Day Low">{fc(quote.low)}</Stat>
            <Stat label="Volume">
              {quote.volume == null
                ? "—"
                : formatNumber(quote.volume, {
                    format: numberFormat,
                    decimals: 0,
                    compact: true,
                  })}
            </Stat>
            <Stat label="52W High">{fc(quote.high52w)}</Stat>
            <Stat label="52W Low">{fc(quote.low52w)}</Stat>
          </div>
        )}
      </Card>

      {/* Your Position — rendered only if the user holds the stock */}
      {position && (
        <Card>
          <div className="border-b border-border p-5">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-fg">
              Your Position
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Quantity">
              {formatNumber(position.quantity, {
                format: numberFormat,
                decimals: 0,
              })}
            </Stat>
            <Stat label="Avg Buy">{fc(position.avgBuyPrice)}</Stat>
            <Stat label="Invested">{fc(position.invested)}</Stat>
            <Stat label="Current Value">
              {position.currentValue == null ? "—" : fc(position.currentValue)}
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
                    "mt-1 font-display text-sm font-bold",
                    position.pnl >= 0 ? "text-gain" : "text-loss",
                  )}
                >
                  {fc(position.pnl, true)}{" "}
                  <span className="text-xs">
                    (
                    {formatPercent(position.pnlPct, {
                      format: numberFormat,
                    })}
                    )
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Candlestick chart with 1W/1M/3M/6M/1Y range selector */}
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
    </div>
  );
}
