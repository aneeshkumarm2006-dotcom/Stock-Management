// Shared Recharts styling for the Analytics page, pulled from tokens.md so
// every chart matches the "Portfolio Dark" design system and the existing
// dashboard AllocationCard. Kept tiny + framework-agnostic (no JSX) so it can
// be imported by any of the chart components.

/** Recharts <Tooltip contentStyle> — the dark popover from tokens.md. */
export const TOOLTIP_CONTENT_STYLE = {
  background: "#1D1F26",
  border: "1px solid #2B2E37",
  borderRadius: 8,
  fontSize: 12,
} as const;

export const TOOLTIP_ITEM_STYLE = { color: "#E6E8EC" } as const;
export const TOOLTIP_LABEL_STYLE = { color: "#94A3B8" } as const;

/** Axis / grid tints (low-contrast, terminal aesthetic). */
export const AXIS_TICK = { fill: "#94A3B8", fontSize: 11 } as const;
export const GRID_STROKE = "#2A3142";

/** Semantic P&L colors — green up / red down, never the blue primary. */
export const GAIN = "#16C784";
export const LOSS = "#EF4444";

/** Brand-forward categorical palette (matches AllocationCard). */
export const PALETTE = [
  "#38BDF8",
  "#16C784",
  "#65FDB5",
  "#4388FD",
  "#94A3B8",
  "#0EA5E9",
  "#FA746F",
  "#2B2E37",
];

export const COUNTRY_LABEL: Record<string, string> = {
  US: "United States",
  CA: "Canada",
};

export const CURRENCY_LABEL: Record<string, string> = {
  USD: "US Dollar",
  CAD: "Canadian Dollar",
};
