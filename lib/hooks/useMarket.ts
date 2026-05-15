"use client";

// Market Insights data layer (PDR §5.5). TanStack Query owns every server
// read; each endpoint is cached + quota-gated server-side (Stage 4/5) and
// returns the Stage-4 cache envelope so the UI can flag stale data (PDR §11).
//
//   /api/indices    → S&P / NASDAQ / Dow / TSX / TSX-V / VIX / USD-CAD
//   /api/movers     → US gainers + losers (free tier: no cap tiers)
//   /api/heatmap     → 11 GICS sector ETF % changes
//   /api/active     → US most-active by volume (free tier: no TSX feed)
//   /api/highs-lows  → 52-week highs/lows (free tier: US approximation)
//
// Market data is not user-specific, so these queries share the app-wide
// TanStack defaults (staleTime 60s) and refresh with the TopBar manual
// refresh (force, cache-bypassing) / 60s market-open auto-refresh (Stage 14).
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/utils/apiFetch";
import type { IndexQuote } from "@/lib/hooks/useDashboard";

export type { IndexQuote };

/* ------------------------------------------------------------------ */
/* Wire types (mirror the Stage 5 route responses)                     */
/* ------------------------------------------------------------------ */

export interface MoverRow {
  symbol: string;
  name: string;
  price: number;
  change: number;
  percentChange: number;
  volume: number;
}

export interface SectorEtfQuote {
  etf: string;
  sector: string;
  price: number;
  percentChange: number;
}

/** Freshness envelope every market route includes (Stage 4/5). */
interface Envelope {
  stale: boolean;
  fetchedAt: string;
  cached: boolean;
}

interface CacheResult<T> extends Envelope {
  data: T;
}

export interface MoversResponse extends Envelope {
  gainers: MoverRow[];
  losers: MoverRow[];
  /** Free tier has no market-cap field → single tier (PDR §5.5 §2). */
  capTiersAvailable: boolean;
}

export interface ActiveResponse extends Envelope {
  us: MoverRow[];
  ca: MoverRow[];
  /** Free tier has no TSX most-active feed (PDR §5.5 §4). */
  caAvailable: boolean;
}

export interface HighsLowsResponse extends Envelope {
  us: { highs: MoverRow[]; lows: MoverRow[] };
  ca: { highs: MoverRow[]; lows: MoverRow[] };
  caAvailable: boolean;
  /** Proxied from gainers/losers feeds on the free tier (PDR §5.5 §5). */
  approximation: boolean;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function useMarketIndicesQuery() {
  return useQuery({
    queryKey: ["indices"],
    queryFn: () => fetchJson<CacheResult<IndexQuote[]>>("/api/indices"),
  });
}

export function useMoversQuery() {
  return useQuery({
    queryKey: ["movers"],
    queryFn: () => fetchJson<MoversResponse>("/api/movers"),
  });
}

export function useHeatmapQuery() {
  return useQuery({
    queryKey: ["heatmap"],
    queryFn: () => fetchJson<CacheResult<SectorEtfQuote[]>>("/api/heatmap"),
  });
}

export function useActiveQuery() {
  return useQuery({
    queryKey: ["active"],
    queryFn: () => fetchJson<ActiveResponse>("/api/active"),
  });
}

export function useHighsLowsQuery() {
  return useQuery({
    queryKey: ["highs-lows"],
    queryFn: () => fetchJson<HighsLowsResponse>("/api/highs-lows"),
  });
}
