// Shared Recharts styling for the Analytics page, pulled from tokens.md so
// every chart matches the "Portfolio Dark" design system and the existing
// dashboard AllocationCard. Kept tiny + framework-agnostic (no JSX) so it can
// be imported by any of the chart components.

/** Recharts <Tooltip contentStyle> — the dark popover from tokens.md. */
export const TOOLTIP_CONTENT_STYLE = {
  background: "#181F31",
  border: "1px solid #3F485E",
  borderRadius: 8,
  fontSize: 12,
} as const;

export const TOOLTIP_ITEM_STYLE = { color: "#DDE5FF" } as const;
export const TOOLTIP_LABEL_STYLE = { color: "#A2ABC5" } as const;

/** Axis / grid tints (low-contrast, terminal aesthetic). */
export const AXIS_TICK = { fill: "#A2ABC5", fontSize: 11 } as const;
export const GRID_STROKE = "#2A3142";

/** Semantic P&L colors — green up / red down, never the blue primary. */
export const GAIN = "#16C784";
export const LOSS = "#EF4444";

/** Brand-forward categorical palette (matches AllocationCard). */
export const PALETTE = [
  "#3B82F6",
  "#16C784",
  "#65FDB5",
  "#4388FD",
  "#A2ABC5",
  "#0E69DC",
  "#FA746F",
  "#3F485E",
];

export const COUNTRY_LABEL: Record<string, string> = {
  US: "United States",
  CA: "Canada",
};

export const CURRENCY_LABEL: Record<string, string> = {
  USD: "US Dollar",
  CAD: "Canadian Dollar",
};
