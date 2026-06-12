"use client";

// Dashboard data layer (PDR §5.2). TanStack Query owns every server read;
// the cached USD→CAD rate is synced into the Settings store so all
// aggregations convert to the display currency BEFORE summing (PDR §9).
//
//   /api/positions  → the user's holdings (+ cached metadata)
//   /api/quotes      → every held symbol's live quote in ONE batched request
//   /api/fx          → USD↔CAD rate (→ settings store)
//   /api/indices     → S&P / NASDAQ / Dow / TSX / USD-CAD strip
//
// computePortfolio (pure, currency-aware) turns the joined data into the
// top-strip / allocation / top-holdings view models.
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { toPositionInput } from "@/lib/utils/buildPositionInput";
import { useCashValue } from "./useCompanies";

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export type AssetType = 'EQUITY' | 'GIC' | 'BOND' | 'MUTUAL_FUND' | 'CASH';
export type PayoutFrequency =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI_ANNUAL'
  | 'ANNUAL'
  | 'AT_MATURITY';

export interface ApiPosition {
  id: string;
  /** Discriminator. Legacy docs without it are served as 'EQUITY'. */
  assetType: AssetType;
  // Equity fields — null on non-equity holdings.
  ticker: string | null;
  exchange: Exchange | null;
  quantity: number | null;
  avgBuyPrice: number | null;
  buyDate: string | null;
  // Common.
  currency: Currency;
  /** Optional "held-by" company ref + its resolved name (null = unassigned). */
  companyId: string | null;
  companyName: string | null;
  // Non-equity fields (null on equities).
  label: string | null;
  institution: string | null;
  principal: number | null;
  startDate: string | null;
  maturityDate: string | null;
  interestRate: number | null;
  payoutFrequency: PayoutFrequency | null;
  costBasis: number | null;
  currentValue: number | null;
  valueAsOf: string | null;
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

/** One symbol's slot in the batched `/api/quotes` response. */
export interface BatchQuoteEntry {
  ticker: string;
  exchange: string;
  /** null when the symbol has no cache and the provider call failed. */
  data: QuotePayload | null;
  stale: boolean;
  fetchedAt: string | null;
}

/** The batched `/api/quotes` response — one entry per requested symbol. */
export interface BatchQuotesResponse {
  quotes: BatchQuoteEntry[];
  /** true when at least one symbol came back stale (TTL/quota/provider). */
  stale: boolean;
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
  /** Total uninvested cash across companies, in the display currency. */
  cashValue: number;
  /** Holdings value + cash (the headline portfolio value). */
  totalValueWithCash: number;
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
  const cashValue = useCashValue();

  const positions = useMemo(
    () => positionsQuery.data?.positions ?? [],
    [positionsQuery.data],
  );

  // Only equities have a live market quote; GIC/Bond/fund/cash are valued
  // without one, so they must NOT trigger /api/quote/undefined/undefined.
  const equityPositions = useMemo(
    () => positions.filter((p) => (p.assetType ?? "EQUITY") === "EQUITY"),
    [positions],
  );

  // Every held symbol's quote in ONE batched request, not a per-holding
  // fan-out. The old fan-out spun up a serverless instance — and a Mongo
  // connection pool — per symbol, which blew the Atlas connection cap
  // (DB_CONNECTION_ISSUE.md). The batch route reads/writes the same
  // server-side cache + quota gate (Stage 4). Sorted so the key is stable
  // regardless of holding order.
  const symbolsParam = useMemo(
    () =>
      equityPositions
        .map((p) => `${p.exchange}:${p.ticker}`)
        .sort()
        .join(","),
    [equityPositions],
  );

  const quotesQuery = useQuery({
    queryKey: ["quote", "batch", symbolsParam],
    enabled: symbolsParam.length > 0,
    queryFn: () =>
      fetchJson<BatchQuotesResponse>(
        `/api/quotes?symbols=${encodeURIComponent(symbolsParam)}`,
      ),
  });

  const quoteByKey = useMemo(() => {
    const map = new Map<string, QuotePayload>();
    for (const q of quotesQuery.data?.quotes ?? []) {
      if (q.data) map.set(`${q.ticker}:${q.exchange}`, q.data);
    }
    return map;
  }, [quotesQuery.data]);

  const isFetchingQuotes = quotesQuery.isLoading;
  const hasStaleQuotes = quotesQuery.data?.stale === true;

  const { summary, holdings } = useMemo(() => {
    if (positions.length === 0) {
      return { summary: null as PortfolioSummary | null, holdings: [] as Holding[] };
    }

    const inputs: PositionInput[] = positions.map((p) =>
      toPositionInput(p, quoteByKey.get(`${p.ticker}:${p.exchange}`)),
    );

    const computed = computePortfolio(inputs, {
      displayCurrency,
      rates,
    });

    // Top Holdings strip is equities-only (it shows tickers + live price).
    const metricsById = new Map(computed.positions.map((m) => [m.id, m]));
    const rows: Holding[] = equityPositions.flatMap((p) => {
      const metrics = metricsById.get(p.id);
      if (!metrics) return [];
      const q = quoteByKey.get(`${p.ticker}:${p.exchange}`);
      return [
        {
          id: p.id,
          ticker: p.ticker ?? "",
          name: p.metadata?.name ?? null,
          logo: p.metadata?.logo ?? null,
          exchange: p.exchange ?? "",
          nativeCurrency: p.currency,
          price: q?.price ?? null,
          metrics,
        },
      ];
    });
    rows.sort((a, b) => b.metrics.currentValue - a.metrics.currentValue);

    return { summary: computed, holdings: rows };
  }, [positions, equityPositions, quoteByKey, displayCurrency, rates]);

  return {
    summary,
    holdings,
    cashValue,
    totalValueWithCash: (summary?.totalValue ?? 0) + cashValue,
    displayCurrency,
    hasPositions: positions.length > 0,
    isLoadingPositions: positionsQuery.isLoading,
    positionsError: (positionsQuery.error as Error | null) ?? null,
    isFetchingQuotes,
    hasStaleQuotes,
    refetchPositions: () => void positionsQuery.refetch(),
  };
}
