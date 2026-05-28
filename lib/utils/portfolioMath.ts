// Pure portfolio math — invested / current value / P&L per position, plus
// aggregates, allocation breakdowns and the diversification (normalized HHI)
// metrics. Every monetary figure is converted to the display currency BEFORE
// aggregation (PDR §9). No I/O here so it is trivially unit-testable.
// Refs: PDR.md §5.2, §5.3, §5.6, §9.
import {
  toDisplayCurrency,
  type Currency,
  type FxRates,
} from "./convertCurrency";

// Both types are free strings now that Position / StockMetadata accept any
// exchange Twelve Data returns and any ISO country code derived from it.
export type Exchange = string;
export type Country = string;

/** A holding joined with its (optional) live quote + metadata. */
export interface PositionInput {
  id: string;
  ticker: string;
  exchange: Exchange;
  quantity: number;
  avgBuyPrice: number; // native currency, per share
  currency: Currency; // native currency of this listing
  sector?: string | null;
  country?: Country | null;
  /** Live price per share, native currency. Null when the quote is missing. */
  price?: number | null;
  /** Per-share day change, native currency. */
  dayChange?: number | null;
}

/** Per-position metrics, all monetary fields in the display currency. */
export interface PositionMetrics {
  id: string;
  ticker: string;
  exchange: Exchange;
  nativeCurrency: Currency;
  quantity: number;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  todaysChange: number;
  /** Portfolio weight %, filled in by computePortfolio. */
  weightPct: number;
  hasQuote: boolean;
}

export interface AllocationSlice {
  key: string;
  value: number;
  pct: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPct: number;
  todaysChange: number;
  todaysChangePct: number;
  positionCount: number;
  displayCurrency: Currency;
  positions: PositionMetrics[];
  allocationByStock: AllocationSlice[];
  allocationBySector: AllocationSlice[];
  allocationByCountry: AllocationSlice[];
  /**
   * Exposure by the position's *native* listing currency (USD vs CAD).
   * Distinct from country: a US company cross-listed on the TSX is held in
   * CAD, so currency exposure can diverge from country exposure (PDR §5.6).
   */
  allocationByCurrency: AllocationSlice[];
  diversification: {
    uniqueSectors: number;
    topWeightPct: number;
    /** Normalized Herfindahl–Hirschman Index, 0 (diverse) – 100 (concentrated). */
    concentrationScore: number;
  };
}

interface ComputeOptions {
  displayCurrency: Currency;
  /** USD-anchored conversion table from the FX cache. */
  rates: FxRates;
}

function computePositionMetrics(
  p: PositionInput,
  { displayCurrency, rates }: ComputeOptions,
): PositionMetrics {
  const conv = (amount: number) =>
    toDisplayCurrency(amount, p.currency, displayCurrency, rates);

  const invested = conv(p.quantity * p.avgBuyPrice);
  const hasQuote = p.price != null && Number.isFinite(p.price);
  // Without a live quote, fall back to cost basis so totals stay sane.
  const currentValue = hasQuote
    ? conv(p.quantity * (p.price as number))
    : invested;
  const pnl = currentValue - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
  const todaysChange =
    hasQuote && p.dayChange != null && Number.isFinite(p.dayChange)
      ? conv(p.quantity * p.dayChange)
      : 0;

  return {
    id: p.id,
    ticker: p.ticker,
    exchange: p.exchange,
    nativeCurrency: p.currency,
    quantity: p.quantity,
    invested,
    currentValue,
    pnl,
    pnlPct,
    todaysChange,
    weightPct: 0,
    hasQuote,
  };
}

function bucket(
  entries: { key: string; value: number }[],
  total: number,
): AllocationSlice[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    map.set(e.key, (map.get(e.key) ?? 0) + e.value);
  }
  return Array.from(map.entries())
    .map(([key, value]) => ({
      key,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Normalized HHI of position weights (fractions 0–1). 0 = perfectly
 * diversified, 100 = a single holding. For n = 1 the metric is defined as 100.
 */
export function concentrationScore(weightFractions: number[]): number {
  const n = weightFractions.length;
  if (n === 0) return 0;
  if (n === 1) return 100;
  const hhi = weightFractions.reduce((s, w) => s + w * w, 0);
  const min = 1 / n;
  const normalized = (hhi - min) / (1 - min);
  return Math.max(0, Math.min(100, normalized * 100));
}

export function computePortfolio(
  input: PositionInput[],
  options: ComputeOptions,
): PortfolioSummary {
  const positions = input.map((p) => computePositionMetrics(p, options));

  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);
  const totalInvested = positions.reduce((s, p) => s + p.invested, 0);
  const totalPnl = totalValue - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const todaysChange = positions.reduce((s, p) => s + p.todaysChange, 0);
  const prevValue = totalValue - todaysChange;
  const todaysChangePct =
    prevValue > 0 ? (todaysChange / prevValue) * 100 : 0;

  for (const p of positions) {
    p.weightPct = totalValue > 0 ? (p.currentValue / totalValue) * 100 : 0;
  }

  const allocationByStock = bucket(
    positions.map((p) => ({ key: p.ticker, value: p.currentValue })),
    totalValue,
  );
  const allocationBySector = bucket(
    input.map((p, i) => ({
      key: p.sector?.trim() || "Unknown",
      value: positions[i]?.currentValue ?? 0,
    })),
    totalValue,
  );
  const allocationByCountry = bucket(
    input.map((p, i) => ({
      key: (p.country ?? "Unknown") || "Unknown",
      value: positions[i]?.currentValue ?? 0,
    })),
    totalValue,
  );

  const allocationByCurrency = bucket(
    input.map((p, i) => ({
      key: p.currency,
      value: positions[i]?.currentValue ?? 0,
    })),
    totalValue,
  );

  const weightFractions = positions.map((p) =>
    totalValue > 0 ? p.currentValue / totalValue : 0,
  );
  const uniqueSectors = new Set(
    input.map((p) => p.sector?.trim() || "Unknown"),
  ).size;
  const topWeightPct = positions.reduce(
    (m, p) => Math.max(m, p.weightPct),
    0,
  );

  return {
    totalValue,
    totalInvested,
    totalPnl,
    totalPnlPct,
    todaysChange,
    todaysChangePct,
    positionCount: positions.length,
    displayCurrency: options.displayCurrency,
    positions,
    allocationByStock,
    allocationBySector,
    allocationByCountry,
    allocationByCurrency,
    diversification: {
      uniqueSectors,
      topWeightPct,
      concentrationScore: concentrationScore(weightFractions),
    },
  };
}
