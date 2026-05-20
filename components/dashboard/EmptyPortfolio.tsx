"use client";

// Empty-portfolio state (PDR §11): shown when the user holds no positions.
// The CTA routes to the Portfolio page where the Add Position panel lives
// (Stage 9); useUiStore.openAddPanel is primed so it opens on arrival.
import Link from "next/link";
import { Plus, Briefcase } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/store/useUiStore";

export function EmptyPortfolio() {
  const openAddPanel = useUiStore((s) => s.openAddPanel);

  return (
    <Card className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-surface-highest">
        <Briefcase className="h-7 w-7 text-fg-muted" />
      </div>
      <h2 className="font-display text-lg font-bold text-fg">
        Your portfolio is empty
      </h2>
      <p className="mt-2 max-w-sm text-sm text-fg-muted">
        Add your first holding to see live valuation, allocation and P&amp;L
        across your US and Canadian positions.
      </p>
      <Link href="/stock/portfolio" className="mt-6">
        <Button onClick={() => openAddPanel()}>
          <Plus className="h-4 w-4" />
          Add Your First Position
        </Button>
      </Link>
    </Card>
  );
}
