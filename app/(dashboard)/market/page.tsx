"use client";

// Market Insights (PDR §5.5). Five stacked, independently-loading sections —
// each owns its own query, skeleton, stale indicator and error+retry so one
// failing feed never blanks the page (PDR §11). Built to the "Portfolio Dark"
// design system + tokens.md (no dedicated Stitch mockup per project scope).
// All five feeds are cached + quota-gated server-side; the TopBar refresh /
// market-open auto-refresh (Stage 6) invalidates these queries.
import { MarketIndices } from "@/components/market/MarketIndices";
import { GainersLosers } from "@/components/market/GainersLosers";
import { SectorHeatmap } from "@/components/market/SectorHeatmap";
import { MostActive } from "@/components/market/MostActive";
import { HighsLows } from "@/components/market/HighsLows";

export default function MarketPage() {
  return (
    <div className="space-y-8">
      <MarketIndices />
      <GainersLosers />
      <SectorHeatmap />
      <MostActive />
      <HighsLows />
    </div>
  );
}
