"use client";

// Shared Recharts styling for the Analytics page. Recharts and other chart
// libraries take colors via inline JS props (not CSS classes), so they cannot
// pick up the theme switch through Tailwind tokens. `useChartTheme()` returns
// a memoized palette keyed on the active theme from `useSettingsStore` so the
// charts re-render with the correct colors when the user flips Dark/Light.
//
// The brand-forward categorical palette stays the same across both themes —
// these hues read on either canvas — but tooltip/grid/axis/cursor tints flip.

import * as React from "react";
import { useSettingsStore } from "@/store/useSettingsStore";

type ChartPalette = {
  tooltipContent: React.CSSProperties;
  tooltipItem: React.CSSProperties;
  tooltipLabel: React.CSSProperties;
  axisTick: { fill: string; fontSize: number };
  gridStroke: string;
  cursorFill: string;
  /** Brand-forward categorical palette (matches AllocationCard). */
  palette: string[];
  /** Tail / "Others" slice color. */
  othersColor: string;
  /** Semantic P&L colors — green up / red down, never the blue primary. */
  gain: string;
  loss: string;
  /** Reference / non-P&L accent (e.g. avg-buy line, "Value" bar). */
  primary: string;
  /** Neutral / "Invested" comparison color. */
  neutral: string;
  /** Candlestick / lightweight-charts colors. */
  candle: {
    up: string;
    down: string;
    grid: string;
    border: string;
    axisText: string;
    avgLine: string;
  };
};

const DARK: ChartPalette = {
  tooltipContent: {
    background: "#1D1F26",
    border: "1px solid #2B2E37",
    borderRadius: 8,
    fontSize: 12,
  },
  tooltipItem: { color: "#E6E8EC" },
  tooltipLabel: { color: "#94A3B8" },
  axisTick: { fill: "#94A3B8", fontSize: 11 },
  gridStroke: "#2A3142",
  cursorFill: "#ffffff08",
  palette: [
    "#38BDF8",
    "#16C784",
    "#65FDB5",
    "#4388FD",
    "#94A3B8",
    "#0EA5E9",
    "#FA746F",
    "#2B2E37",
  ],
  othersColor: "#2B2E37",
  gain: "#16C784",
  loss: "#EF4444",
  primary: "#38BDF8",
  neutral: "#94A3B8",
  candle: {
    up: "#16C784",
    down: "#EF4444",
    grid: "#24272F",
    border: "#2B2E37",
    axisText: "#94A3B8",
    avgLine: "#38BDF8",
  },
};

const LIGHT: ChartPalette = {
  tooltipContent: {
    background: "#FFFFFF",
    border: "1px solid #CBD5E1",
    borderRadius: 8,
    fontSize: 12,
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
  },
  tooltipItem: { color: "#0F172A" },
  tooltipLabel: { color: "#475569" },
  axisTick: { fill: "#475569", fontSize: 11 },
  gridStroke: "#E2E8F0",
  cursorFill: "#0f172a0a",
  palette: [
    "#0284C7",
    "#15803D",
    "#16C784",
    "#1D4ED8",
    "#475569",
    "#0EA5E9",
    "#DC2626",
    "#CBD5E1",
  ],
  othersColor: "#CBD5E1",
  gain: "#15803D",
  loss: "#DC2626",
  primary: "#0284C7",
  neutral: "#475569",
  candle: {
    up: "#15803D",
    down: "#DC2626",
    grid: "#E2E8F0",
    border: "#CBD5E1",
    axisText: "#475569",
    avgLine: "#0284C7",
  },
};

export function useChartTheme(): ChartPalette {
  const theme = useSettingsStore((s) => s.theme);
  return theme === "light" ? LIGHT : DARK;
}

export const COUNTRY_LABEL: Record<string, string> = {
  US: "United States",
  CA: "Canada",
};

export const CURRENCY_LABEL: Record<string, string> = {
  USD: "US Dollar",
  CAD: "Canadian Dollar",
};
