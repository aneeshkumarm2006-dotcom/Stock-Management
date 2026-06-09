"use client";

// Stock-detail data layer (PDR §5.4). TanStack Query owns every server read:
//
//   /api/quote/[ex]/[tk]    → live price block (cache envelope → stale flag)
//   /api/profile/[ex]/[tk]  → header logo / name / sector / industry
//   /api/history/[ex]/[tk]  → candlestick OHLCV, re-keyed per range selector
//   /api/positions          → detect whether the user holds this symbol
//
// The page is viewable for ANY valid symbol (research mode). The "Your
// Position" card is derived only when a matching holding exists, and is shown
// in that position's NATIVE currency — a single-symbol view stays honest about
// the listing currency rather than mixing in the display-currency toggle
// (PDR §9; same rule the holdings table uses for native price columns).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/utils/apiFetch";
import { usePositionsQuery, type ApiPosition } from "./useDashboard";
import type { Currency } from "@/lib/utils/convertCurrency";
import type { Exchange, Country } from "@/lib/utils/portfolioMath";
import type { HistoricalRange } from "@/lib/db/models/HistoricalCache";

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

interface CacheResult<T> {
  data: T;
  stale: boolean;
  fetchedAt: string;
  cached: boolean;
}

export interface QuotePayload {
  ticker: string;
  exchange: string;
  price: number;
  dayChange: number;
  dayChangePct: number;
  high52w?: number;
  low52w?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface ProfilePayload {
  ticker: string;
  exchange: string;
  name?: string;
  logo?: string;
  sector?: string;
  industry?: string;
  country: Country;
}

/** One OHLCV candle as it arrives over the wire (`time` is an ISO string). */
export interface WireCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HistoryResponse extends CacheResult<{ candles: WireCandle[] }> {
  range: HistoricalRange;
}

export const RANGES: HistoricalRange[] = ["1W", "1M", "3M", "6M", "1Y"];

/** Derived "Your Position" card model — native currency (PDR §5.4, §9). */
export interface HeldPosition {
  id: string;
  quantity: number;
  avgBuyPrice: number;
  currency: Currency;
  buyDate: string | null;
  invested: number;
  /** null until the live quote resolves. */
  currentValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
}

/* ------------------------------------------------------------------ */
/* Combined model                                                      */
/* ------------------------------------------------------------------ */

export interface StockDetailData {
  ticker: string;
  exchange: Exchange;
  quote: QuotePayload | null;
  quoteStale: boolean;
  isLoadingQuote: boolean;
  quoteError: Error | null;
  refetchQuote: () => void;

  profile: ProfilePayload | null;
  isLoadingProfile: boolean;

  /** Non-null only when the signed-in user holds this exact symbol. */
  position: HeldPosition | null;

  range: HistoricalRange;
  setRange: (r: HistoricalRange) => void;
  candles: WireCandle[];
  historyStale: boolean;
  isLoadingHistory: boolean;
  historyError: Error | null;
  refetchHistory: () => void;
}

export function useStockDetail(
  exchange: Exchange,
  ticker: string,
): StockDetailData {
  const [range, setRange] = useState<HistoricalRange>("1M");
  const encoded = encodeURIComponent(ticker);

  const quoteQuery = useQuery({
    queryKey: ["quote", exchange, ticker],
    queryFn: () =>
      fetchJson<CacheResult<QuotePayload>>(
        `/api/quote/${exchange}/${encoded}`,
      ),
  });

  // Profile may legitimately 404 (unknown symbol / no cached fallback). That
  // is not a page error — the header just degrades to ticker + exchange — so
  // don't retry a 404 and don't surface it as an error.
  const profileQuery = useQuery({
    queryKey: ["profile", exchange, ticker],
    queryFn: () =>
      fetchJson<CacheResult<ProfilePayload>>(
        `/api/profile/${exchange}/${encoded}`,
      ),
    staleTime: 6 * 60 * 60 * 1000, // server caches 7d (Stage 4)
    retry: (count, err) =>
      (err as { status?: number }).status === 404 ? false : count < 2,
  });

  const historyQuery = useQuery({
    queryKey: ["history", exchange, ticker, range],
    queryFn: () =>
      fetchJson<HistoryResponse>(
        `/api/history/${exchange}/${encoded}?range=${range}`,
      ),
  });

  // Detect a matching holding from the user's positions (the same cached
  // ["positions"] query the dashboard / portfolio already populate).
  const positionsQuery = usePositionsQuery();
  const held: ApiPosition | undefined = useMemo(
    () =>
      positionsQuery.data?.positions.find(
        (p) => p.ticker === ticker && p.exchange === exchange,
      ),
    [positionsQuery.data, ticker, exchange],
  );

  const quote = quoteQuery.data?.data ?? null;

  const position: HeldPosition | null = useMemo(() => {
    if (!held) return null;
    // Only equities match a ticker/exchange lookup, so these are always
    // present here; coalesce to satisfy the now-nullable ApiPosition fields.
    const quantity = held.quantity ?? 0;
    const avgBuyPrice = held.avgBuyPrice ?? 0;
    const invested = quantity * avgBuyPrice;
    const price = quote?.price ?? null;
    const currentValue = price == null ? null : quantity * price;
    const pnl =
      currentValue == null ? null : currentValue - invested;
    const pnlPct =
      pnl == null || invested === 0 ? null : (pnl / invested) * 100;
    return {
      id: held.id,
      quantity,
      avgBuyPrice,
      currency: held.currency,
      buyDate: held.buyDate,
      invested,
      currentValue,
      pnl,
      pnlPct,
    };
  }, [held, quote]);

  return {
    ticker,
    exchange,
    quote,
    quoteStale: quoteQuery.data?.stale ?? false,
    isLoadingQuote: quoteQuery.isLoading,
    quoteError: (quoteQuery.error as Error | null) ?? null,
    refetchQuote: () => void quoteQuery.refetch(),

    profile: profileQuery.data?.data ?? null,
    isLoadingProfile: profileQuery.isLoading,

    position,

    range,
    setRange,
    candles: historyQuery.data?.data.candles ?? [],
    historyStale: historyQuery.data?.stale ?? false,
    isLoadingHistory: historyQuery.isLoading,
    historyError: (historyQuery.error as Error | null) ?? null,
    refetchHistory: () => void historyQuery.refetch(),
  };
}
