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
  type PortfolioSummary,
  type PositionInput,
  type PositionMetrics,
  type Exchange,
  type Country,
} from "@/lib/utils/portfolioMath";
import type { Currency } from "@/lib/utils/convertCurrency";
import { toPositionInput } from "@/lib/utils/buildPositionInput";
import { valuateHolding } from "@/lib/utils/assetValuation";
import {
  usePositionsQuery,
  useFxSync,
  type ApiPosition,
  type AssetType,
  type PayoutFrequency,
} from "./useDashboard";
import { useCashValue } from "./useCompanies";

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
  /** MIC code (e.g. ARCX, BATS, XNAS). Optional — used by the form to map
   *  sub-exchanges to a storable parent (NYSE / NASDAQ / TSX). */
  micCode?: string;
  country: string;
  currency: string;
  instrumentType: string;
}

/** One holding joined with metadata + its live quote, ready for the table. */
export interface PortfolioRow {
  id: string;
  assetType: AssetType;
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
  /** Optional "held-by" company ref + its resolved name (null = unassigned). */
  companyId: string | null;
  companyName: string | null;
  /** Display-currency metrics (invested / value / P&L / weight). */
  metrics: PositionMetrics;
  // --- Non-equity display fields (null on equities) ---
  label: string | null;
  institution: string | null;
  principal: number | null;
  interestRate: number | null;
  payoutFrequency: PayoutFrequency | null;
  startDate: string | null;
  maturityDate: string | null;
  /** Maturity value (GIC/Bond), native currency. */
  maturityValue: number | null;
  costBasis: number | null;
  /** Manually-entered current value (fund/cash), native currency. */
  currentValueNative: number | null;
  valueAsOf: string | null;
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
  // Metadata is authoritative once Finnhub fills it in (any of the ~50
  // exchanges in finnhub.ts EXCHANGE_META). While that's still in flight we
  // fall back to the legacy NYSE/NASDAQ → US, TSX → CA mapping for the
  // common-case so the country donut isn't blank for fresh adds.
  if (p.metadata?.country) return p.metadata.country;
  return p.exchange === "TSX" ? "CA" : "US";
}

/* ------------------------------------------------------------------ */
/* Combined portfolio model                                            */
/* ------------------------------------------------------------------ */

export interface PortfolioData {
  rows: PortfolioRow[];
  stats: PortfolioStats;
  /** Currency-aware portfolio aggregates, or null until rows compute. */
  summary: PortfolioSummary | null;
  /** Distinct sectors present (for the filter dropdown). */
  sectors: string[];
  /** Total uninvested cash across companies, in the display currency. */
  cashValue: number;
  /** Holdings value + cash (the headline portfolio value). */
  totalValueWithCash: number;
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
  const rates = useSettingsStore((s) => s.fxRates);

  const positionsQuery = usePositionsQuery();
  useFxSync();
  const cashValue = useCashValue();

  const positions = useMemo(
    () => positionsQuery.data?.positions ?? [],
    [positionsQuery.data],
  );

  // Only equities have a live market quote; non-equity holdings are valued
  // without one and must not hit /api/quote/undefined/undefined.
  const equityPositions = useMemo(
    () => positions.filter((p) => (p.assetType ?? "EQUITY") === "EQUITY"),
    [positions],
  );

  // One live quote per held symbol (no free-tier batch route; each is cached
  // + quota-gated server-side — Stage 4), exactly as the dashboard does.
  const quoteResults = useQueries({
    queries: equityPositions.map((p) => ({
      queryKey: ["quote", p.exchange, p.ticker] as const,
      queryFn: () =>
        fetchJson<CacheResult<QuotePayload>>(
          `/api/quote/${p.exchange}/${encodeURIComponent(p.ticker ?? "")}`,
        ),
    })),
  });

  const quoteByKey = useMemo(() => {
    const map = new Map<string, QuotePayload>();
    equityPositions.forEach((p, i) => {
      const data = quoteResults[i]?.data?.data;
      if (data) map.set(`${p.ticker}:${p.exchange}`, data);
    });
    return map;
  }, [equityPositions, quoteResults]);

  const isFetchingQuotes = quoteResults.some((q) => q.isLoading);
  const hasStaleQuotes = quoteResults.some((q) => q.data?.stale === true);

  const { rows, stats, sectors, summary } = useMemo(() => {
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
        summary: null as PortfolioSummary | null,
      };
    }

    const inputs: PositionInput[] = positions.map((p) =>
      toPositionInput(p, quoteByKey.get(`${p.ticker}:${p.exchange}`)),
    );

    const computed = computePortfolio(inputs, { displayCurrency, rates });
    const metricsById = new Map(computed.positions.map((m) => [m.id, m]));

    const built: PortfolioRow[] = positions.flatMap((p) => {
      const metrics = metricsById.get(p.id);
      if (!metrics) return [];
      const isEquity = (p.assetType ?? "EQUITY") === "EQUITY";
      const q = quoteByKey.get(`${p.ticker}:${p.exchange}`);
      // Native-currency valuation for non-equity (maturity value, etc.).
      const valuation = isEquity
        ? null
        : valuateHolding({
            assetType: p.assetType,
            currency: p.currency,
            principal: p.principal,
            interestRate: p.interestRate,
            payoutFrequency: p.payoutFrequency,
            startDate: p.startDate,
            maturityDate: p.maturityDate,
            costBasis: p.costBasis,
            currentValue: p.currentValue,
          });
      return [
        {
          id: p.id,
          assetType: p.assetType ?? "EQUITY",
          ticker: p.ticker ?? "",
          name: p.metadata?.name ?? p.label ?? null,
          logo: p.metadata?.logo ?? null,
          exchange: p.exchange ?? "",
          sector: p.metadata?.sector ?? null,
          industry: p.metadata?.industry ?? null,
          country: deriveCountry(p),
          nativeCurrency: p.currency,
          buyDate: p.buyDate,
          quantity: p.quantity ?? 0,
          avgBuyPrice: p.avgBuyPrice ?? 0,
          price: isEquity ? q?.price ?? null : null,
          companyId: p.companyId,
          companyName: p.companyName ?? null,
          metrics,
          // Non-equity display fields.
          label: p.label ?? null,
          institution: p.institution ?? null,
          principal: p.principal ?? null,
          interestRate: p.interestRate ?? null,
          payoutFrequency: p.payoutFrequency ?? null,
          startDate: p.startDate ?? null,
          maturityDate: p.maturityDate ?? null,
          maturityValue: valuation ? valuation.maturityValue : null,
          costBasis: p.costBasis ?? null,
          currentValueNative: valuation ? valuation.currentValue : null,
          valueAsOf: p.valueAsOf ?? null,
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

    const best = pick(quoted, (a, b) => b.metrics.pnlPct - a.metrics.pnlPct);
    const worst = pick(quoted, (a, b) => a.metrics.pnlPct - b.metrics.pnlPct);

    // With a single quoted holding, best and worst resolve to the same row.
    // Showing one stock in both cards is misleading (a position in loss
    // appearing as "best performer"), so attribute it to only one card based
    // on its sign and leave the other empty.
    const onlyOne = best !== null && best === worst;
    const isGain = best !== null && best.metrics.pnlPct >= 0;

    const statsValue: PortfolioStats = {
      bestPerformer: onlyOne ? (isGain ? best : null) : best,
      worstPerformer: onlyOne ? (isGain ? null : worst) : worst,
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

    return { rows: built, stats: statsValue, sectors: sectorList, summary: computed };
  }, [positions, quoteByKey, displayCurrency, rates]);

  return {
    rows,
    stats,
    summary,
    sectors,
    cashValue,
    totalValueWithCash: (summary?.totalValue ?? 0) + cashValue,
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

interface CreateEquityInput {
  assetType?: "EQUITY";
  ticker: string;
  exchange: Exchange;
  quantity: number;
  avgBuyPrice: number;
  currency: Currency;
  buyDate?: string;
  /** Optional held-by company id; null/"" clears it. */
  companyId?: string | null;
}

interface CreateFixedIncomeInput {
  assetType: "GIC" | "BOND";
  label: string;
  institution: string;
  principal: number;
  currency: Currency;
  startDate: string;
  maturityDate: string;
  interestRate: number;
  payoutFrequency: PayoutFrequency;
  companyId?: string | null;
}

interface CreateMutualFundInput {
  assetType: "MUTUAL_FUND";
  label: string;
  currency: Currency;
  costBasis: number;
  currentValue: number;
  valueAsOf?: string;
  companyId?: string | null;
}

interface CreateCashInput {
  assetType: "CASH";
  label: string;
  currency: Currency;
  currentValue: number;
  companyId?: string | null;
}

export type CreatePositionInput =
  | CreateEquityInput
  | CreateFixedIncomeInput
  | CreateMutualFundInput
  | CreateCashInput;

export type UpdatePositionInput =
  | {
      mode?: "replace";
      // Equity
      quantity?: number;
      avgBuyPrice?: number;
      // Common
      label?: string;
      currency?: Currency;
      /** Optional held-by company id; null/"" clears it. */
      companyId?: string | null;
      // Fixed income
      institution?: string;
      principal?: number;
      startDate?: string;
      maturityDate?: string;
      interestRate?: number;
      payoutFrequency?: PayoutFrequency;
      // Manual valuation
      costBasis?: number;
      currentValue?: number;
      valueAsOf?: string;
    }
  | { mode: "add"; addQuantity: number; addPrice: number }
  | { mode: "updateValue"; currentValue: number };

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
