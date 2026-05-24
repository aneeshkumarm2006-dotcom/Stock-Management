"use client";

// Empty-portfolio state (PDR §11): shown when the user holds no positions.
// The CTA routes to the Portfolio page where the Add Position panel lives
// (Stage 9); useUiStore.openAddPanel is primed so it opens on arrival.
// Visual treatment mirrors the Lattice design's "Coming soon" empty pattern:
// neutral icon tile, 20px / 650 title, muted 13px copy, brand-tonal CTA.
import Link from "next/link";
import { Plus, Briefcase } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/store/useUiStore";

export function EmptyPortfolio() {
  const openAddPanel = useUiStore((s) => s.openAddPanel);

  return (
    <Card className="flex min-h-[500px] flex-col items-center justify-center gap-4 px-10 py-[60px] text-center">
      <div className="grid h-16 w-16 place-items-center rounded-lg border border-border bg-surface-low">
        <Briefcase className="h-7 w-7 text-fg-muted" strokeWidth={1.5} />
      </div>
      <div>
        <h2 className="text-[20px] font-[650] tracking-[-0.018em] text-fg">
          Your portfolio is empty
        </h2>
        <p className="mt-2 max-w-[360px] text-[13px] leading-[1.5] text-fg-muted">
          Add your first holding to see live valuation, allocation and P&amp;L
          across your US and Canadian positions.
        </p>
      </div>
      <Link href="/stock/portfolio" className="mt-2">
        <Button onClick={() => openAddPanel()}>
          <Plus className="h-[13px] w-[13px]" />
          Add your first position
        </Button>
      </Link>
    </Card>
  );
}
