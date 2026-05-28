"use client";

// Dashboard data layer (PDR §5.2). TanStack Query owns every server read;
// the cached USD→CAD rate is synced into the Settings store so all
// aggregations convert to the display currency BEFORE summing (PDR §9).
//
//   /api/positions  → the user's holdings (+ cached metadata)
//   /api/quote/...   → one live quote per held symbol (parallel useQueries)
//   /api/fx          → USD↔CAD rate (→ settings store)
//   /api/indices     → S&P / NASDAQ / Dow / TSX / USD-CAD strip
//
// computePortfolio (pure, currency-aware) turns the joined data into the
// top-strip / allocation / top-holdings view models.
import { useEffect, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchJson } from "@/lib/utils/apiFetch";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  computePortfolio,
  type PortfolioSummary,
  type PositionInput,
  type PositionMetrics,
  type Exchange,
  type Country,
} from "@/lib/utils/portfolioMath";
import type { Currency } from "@/lib/utils/convertCurrency";

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export interface ApiPosition {
  id: string;
  ticker: string;
  exchange: Exchange;
  quantity: number;
  avgBuyPrice: number;
  currency: Currency;
  buyDate: string | null;
  metadata: {
    name: string | null;
    logo: string | null;
    sector: string | null;
    industry: string | null;
    country: Country | null;
  } | null;
}

interface QuotePayload {
  ticker: string;
  exchange: string;
  price: number;
  dayChange: number;
  dayChangePct: number;
  high52w?: number;
  low52w?: number;
}

/** Cache envelope every market-data route returns (Stage 4/5). */
interface CacheResult<T> {
  data: T;
  stale: boolean;
  fetchedAt: string;
  cached: boolean;
}

export interface IndexQuote {
  key: string;
  symbol: string;
  label: string;
  price: number;
  change: number;
  percentChange: number;
}

/** A holding row joined with its live quote, for the Top Holdings table. */
export interface Holding {
  id: string;
  ticker: string;
  name: string | null;
  logo: string | null;
  exchange: Exchange;
  nativeCurrency: Currency;
  /** Live price per share in native currency; null when the quote is missing. */
  price: number | null;
  metrics: PositionMetrics;
}

/* ------------------------------------------------------------------ */
/* Individual queries                                                  */
/* ------------------------------------------------------------------ */

export function usePositionsQuery() {
  return useQuery({
    queryKey: ["positions"],
    queryFn: () =>
      fetchJson<{ positions: ApiPosition[] }>("/api/positions"),
  });
}

/** Indices strip — its own cache envelope so we can flag stale data. */
export function useIndicesQuery() {
  return useQuery({
    queryKey: ["indices"],
    queryFn: () => fetchJson<CacheResult<IndexQuote[]>>("/api/indices"),
  });
}

/**
 * FX query — mirrors the full USD-based conversion table into the Settings
 * store so every aggregation can convert between any pair of currencies the
 * provider supports (USD/CAD/EUR/GBP/JPY/AUD/HKD/INR/…).
 */
export function useFxSync() {
  const setFxRates = useSettingsStore((s) => s.setFxRates);
  const query = useQuery({
    queryKey: ["fx"],
    queryFn: () =>
      fetchJson<
        CacheResult<{
          usdToCad: number;
          cadToUsd: number;
          rates: Record<string, number>;
        }>
      >("/api/fx"),
    // FX is cached 24h server-side; no need to refetch aggressively.
    staleTime: 60 * 60 * 1000,
  });

  const rates = query.data?.data?.rates;
  useEffect(() => {
    if (rates && typeof rates === "object" && Object.keys(rates).length > 0) {
      setFxRates(rates);
    }
  }, [rates, setFxRates]);

  return query;
}

/* ------------------------------------------------------------------ */
/* Combined dashboard model                                            */
/* ------------------------------------------------------------------ */

export interface DashboardData {
  /** Currency-aware portfolio aggregates, or null until positions load. */
  summary: PortfolioSummary | null;
  /** Holdings joined with live price, sorted by current value desc. */
  holdings: Holding[];
  displayCurrency: Currency;
  hasPositions: boolean;
  isLoadingPositions: boolean;
  positionsError: Error | null;
  /** A live quote is still in flight (totals shown are provisional). */
  isFetchingQuotes: boolean;
  /** At least one quote came back stale (over-quota / provider down). */
  hasStaleQuotes: boolean;
  refetchPositions: () => void;
}

export function useDashboardData(): DashboardData {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const rates = useSettingsStore((s) => s.fxRates);

  const positionsQuery = usePositionsQuery();
  useFxSync();

  const positions = useMemo(
    () => positionsQuery.data?.positions ?? [],
    [positionsQuery.data],
  );

  // One live quote per held symbol, in parallel (no batch route on the
  // free tier; each is cached + quota-gated server-side — Stage 4).
  const quoteResults = useQueries({
    queries: positions.map((p) => ({
      queryKey: ["quote", p.exchange, p.ticker] as const,
      queryFn: () =>
        fetchJson<CacheResult<QuotePayload>>(
          `/api/quote/${p.exchange}/${encodeURIComponent(p.ticker)}`,
        ),
    })),
  });

  const quoteByKey = useMemo(() => {
    const map = new Map<string, QuotePayload>();
    positions.forEach((p, i) => {
      const data = quoteResults[i]?.data?.data;
      if (data) map.set(`${p.ticker}:${p.exchange}`, data);
    });
    return map;
  }, [positions, quoteResults]);

  const isFetchingQuotes = quoteResults.some((q) => q.isLoading);
  const hasStaleQuotes = quoteResults.some((q) => q.data?.stale === true);

  const { summary, holdings } = useMemo(() => {
    if (positions.length === 0) {
      return { summary: null as PortfolioSummary | null, holdings: [] as Holding[] };
    }

    const inputs: PositionInput[] = positions.map((p) => {
      const q = quoteByKey.get(`${p.ticker}:${p.exchange}`);
      return {
        id: p.id,
        ticker: p.ticker,
        exchange: p.exchange,
        quantity: p.quantity,
        avgBuyPrice: p.avgBuyPrice,
        currency: p.currency,
        sector: p.metadata?.sector ?? null,
        country: p.metadata?.country ?? null,
        price: q?.price ?? null,
        dayChange: q?.dayChange ?? null,
      };
    });

    const computed = computePortfolio(inputs, {
      displayCurrency,
      rates,
    });

    const metricsById = new Map(computed.positions.map((m) => [m.id, m]));
    const rows: Holding[] = positions.flatMap((p) => {
      const metrics = metricsById.get(p.id);
      if (!metrics) return [];
      const q = quoteByKey.get(`${p.ticker}:${p.exchange}`);
      return [
        {
          id: p.id,
          ticker: p.ticker,
          name: p.metadata?.name ?? null,
          logo: p.metadata?.logo ?? null,
          exchange: p.exchange,
          nativeCurrency: p.currency,
          price: q?.price ?? null,
          metrics,
        },
      ];
    });
    rows.sort((a, b) => b.metrics.currentValue - a.metrics.currentValue);

    return { summary: computed, holdings: rows };
  }, [positions, quoteByKey, displayCurrency, rates]);

  return {
    summary,
    holdings,
    displayCurrency,
    hasPositions: positions.length > 0,
    isLoadingPositions: positionsQuery.isLoading,
    positionsError: (positionsQuery.error as Error | null) ?? null,
    isFetchingQuotes,
    hasStaleQuotes,
    refetchPositions: () => void positionsQuery.refetch(),
  };
}
