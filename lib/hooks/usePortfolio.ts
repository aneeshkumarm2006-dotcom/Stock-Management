"use client";

// Portfolio data layer (PDR §5.1, §5.3, §9). Builds on the same query
// primitives as the dashboard (usePositionsQuery / useFxSync / computePortfolio)
// but exposes the *fuller* per-position row the holdings table needs
// (name, sector, country, avg buy, invested, native live price) plus the
// four stat-card derivations and the create / update / delete mutations.
//
// Every monetary figure is converted to the display currency BEFORE
// aggregation via computePortfolio (PDR §9); rows still carry their native
// currency so the table can show the listing-currency flag.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/utils/apiFetch";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  computePortfolio,
  type PositionInput,
  type PositionMetrics,
  type Exchange,
  type Country,
} from "@/lib/utils/portfolioMath";
import type { Currency } from "@/lib/utils/convertCurrency";
import { usePositionsQuery, useFxSync, type ApiPosition } from "./useDashboard";

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

interface QuotePayload {
  ticker: string;
  exchange: string;
  price: number;
  dayChange: number;
  dayChangePct: number;
}

interface CacheResult<T> {
  data: T;
  stale: boolean;
  fetchedAt: string;
  cached: boolean;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  country: string;
  currency: string;
  instrumentType: string;
}

/** One holding joined with metadata + its live quote, ready for the table. */
export interface PortfolioRow {
  id: string;
  ticker: string;
  name: string | null;
  logo: string | null;
  exchange: Exchange;
  sector: string | null;
  industry: string | null;
  country: Country;
  nativeCurrency: Currency;
  buyDate: string | null;
  quantity: number;
  /** Average buy price per share, native currency. */
  avgBuyPrice: number;
  /** Live price per share, native currency; null when the quote is missing. */
  price: number | null;
  /** Display-currency metrics (invested / value / P&L / weight). */
  metrics: PositionMetrics;
}

/** The four PDR §5.3 stat cards. Null until at least one row is computed. */
export interface PortfolioStats {
  bestPerformer: PortfolioRow | null;
  worstPerformer: PortfolioRow | null;
  highestValue: PortfolioRow | null;
  largestWeight: PortfolioRow | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function deriveCountry(p: ApiPosition): Country {
  return p.metadata?.country ?? (p.exchange === "TSX" ? "CA" : "US");
}

/* ------------------------------------------------------------------ */
/* Combined portfolio model                                            */
/* ------------------------------------------------------------------ */

export interface PortfolioData {
  rows: PortfolioRow[];
  stats: PortfolioStats;
  /** Distinct sectors present (for the filter dropdown). */
  sectors: string[];
  displayCurrency: Currency;
  hasPositions: boolean;
  isLoadingPositions: boolean;
  positionsError: Error | null;
  isFetchingQuotes: boolean;
  hasStaleQuotes: boolean;
  refetch: () => void;
}

export function usePortfolio(): PortfolioData {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const usdToCad = useSettingsStore((s) => s.fxUsdToCad);

  const positionsQuery = usePositionsQuery();
  useFxSync();

  const positions = useMemo(
    () => positionsQuery.data?.positions ?? [],
    [positionsQuery.data],
  );

  // One live quote per held symbol (no free-tier batch route; each is cached
  // + quota-gated server-side — Stage 4), exactly as the dashboard does.
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

  const { rows, stats, sectors } = useMemo(() => {
    if (positions.length === 0) {
      return {
        rows: [] as PortfolioRow[],
        stats: {
          bestPerformer: null,
          worstPerformer: null,
          highestValue: null,
          largestWeight: null,
        } as PortfolioStats,
        sectors: [] as string[],
      };
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
        country: deriveCountry(p),
        price: q?.price ?? null,
        dayChange: q?.dayChange ?? null,
      };
    });

    const computed = computePortfolio(inputs, { displayCurrency, usdToCad });
    const metricsById = new Map(computed.positions.map((m) => [m.id, m]));

    const built: PortfolioRow[] = positions.flatMap((p) => {
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
          sector: p.metadata?.sector ?? null,
          industry: p.metadata?.industry ?? null,
          country: deriveCountry(p),
          nativeCurrency: p.currency,
          buyDate: p.buyDate,
          quantity: p.quantity,
          avgBuyPrice: p.avgBuyPrice,
          price: q?.price ?? null,
          metrics,
        },
      ];
    });

    // Default order: current value desc (matches the dashboard / design).
    built.sort((a, b) => b.metrics.currentValue - a.metrics.currentValue);

    // Stat cards — performers only make sense for quoted rows.
    const quoted = built.filter((r) => r.metrics.hasQuote);
    const pick = (
      list: PortfolioRow[],
      cmp: (a: PortfolioRow, b: PortfolioRow) => number,
    ): PortfolioRow | null =>
      list.length === 0 ? null : list.slice().sort(cmp)[0] ?? null;

    const statsValue: PortfolioStats = {
      bestPerformer: pick(
        quoted,
        (a, b) => b.metrics.pnlPct - a.metrics.pnlPct,
      ),
      worstPerformer: pick(
        quoted,
        (a, b) => a.metrics.pnlPct - b.metrics.pnlPct,
      ),
      highestValue: pick(
        built,
        (a, b) => b.metrics.currentValue - a.metrics.currentValue,
      ),
      largestWeight: pick(
        built,
        (a, b) => b.metrics.weightPct - a.metrics.weightPct,
      ),
    };

    const sectorList = Array.from(
      new Set(built.map((r) => r.sector?.trim()).filter(Boolean) as string[]),
    ).sort();

    return { rows: built, stats: statsValue, sectors: sectorList };
  }, [positions, quoteByKey, displayCurrency, usdToCad]);

  return {
    rows,
    stats,
    sectors,
    displayCurrency,
    hasPositions: positions.length > 0,
    isLoadingPositions: positionsQuery.isLoading,
    positionsError: (positionsQuery.error as Error | null) ?? null,
    isFetchingQuotes,
    hasStaleQuotes,
    refetch: () => void positionsQuery.refetch(),
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export interface CreatePositionInput {
  ticker: string;
  exchange: Exchange;
  quantity: number;
  avgBuyPrice: number;
  currency: Currency;
  buyDate?: string;
}

export type UpdatePositionInput =
  | { mode?: "replace"; quantity?: number; avgBuyPrice?: number }
  | { mode: "add"; addQuantity: number; addPrice: number };

/**
 * Invalidate everything a position change can affect: the positions list and
 * every per-symbol quote (a new holding needs its quote fetched). The async
 * Finnhub metadata fetch (PDR §5.1) lands in the StockMetadata cache shortly
 * after a create, so we re-invalidate positions once more after a short delay
 * to surface the logo / name / sector when it is ready.
 */
function useInvalidatePortfolio() {
  const qc = useQueryClient();
  return (opts: { delayedMetadata?: boolean } = {}) => {
    void qc.invalidateQueries({ queryKey: ["positions"] });
    void qc.invalidateQueries({ queryKey: ["quote"] });
    if (opts.delayedMetadata) {
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["positions"] });
      }, 3000);
    }
  };
}

export function useCreatePosition() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: async (input: CreatePositionInput) => {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: () => invalidate({ delayedMetadata: true }),
  });
}

export function useUpdatePosition() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      input: UpdatePositionInput;
    }) => {
      const res = await fetch(`/api/positions/${args.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args.input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: () => invalidate(),
  });
}

export function useDeletePosition() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/positions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: () => invalidate(),
  });
}

/* ------------------------------------------------------------------ */
/* Symbol-search typeahead (debounced 300ms — PDR §5.1, §8)            */
/* ------------------------------------------------------------------ */

export function useSymbolSearch(query: string) {
  const [debounced, setDebounced] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const result = useQuery({
    queryKey: ["search", debounced],
    enabled: debounced.length >= 1,
    staleTime: 7 * 24 * 60 * 60 * 1000, // server caches 7d (Stage 4)
    queryFn: () =>
      fetchJson<CacheResult<SymbolSearchResult[]>>(
        `/api/search?q=${encodeURIComponent(debounced)}`,
      ),
  });

  return {
    results: result.data?.data ?? [],
    isSearching:
      debounced.length >= 1 && (result.isLoading || result.isFetching),
    query: debounced,
  };
}
