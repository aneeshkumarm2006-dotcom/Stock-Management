"use client";

// Type-aware edit router. Mounts all three edit panels at once; each one gates
// its own SidePanel `open` on whether the row resolved from
// useUiStore.editPanelPositionId matches its asset type, so exactly one is open
// at a time and slide-out animations are preserved on close.
import type { PortfolioRow } from "@/lib/hooks/usePortfolio";
import { EditPositionPanel } from "./EditPositionPanel";
import { EditFixedIncomePanel } from "./EditFixedIncomePanel";
import { EditManualPanel } from "./EditManualPanel";

export function EditHoldingPanel({ rows }: { rows: PortfolioRow[] }) {
  return (
    <>
      <EditPositionPanel rows={rows} />
      <EditFixedIncomePanel rows={rows} />
      <EditManualPanel rows={rows} />
    </>
  );
}
