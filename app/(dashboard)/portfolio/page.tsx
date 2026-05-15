"use client";

// Portfolio page (PDR §5.1, §5.3, §11). Full holdings management: the four
// performance stat cards, the searchable/filterable/sortable holdings table,
// and the slide-in Add / Edit panels + delete confirmation. Layout follows
// site/design/portfolio; currency reflows reactively via the Settings store
// (TopBar USD/CAD toggle, Stage 6). Data + mutations come from usePortfolio.
import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  usePortfolio,
  type PortfolioRow,
} from "@/lib/hooks/usePortfolio";
import { useUiStore } from "@/store/useUiStore";
import { Button } from "@/components/ui/button";
import {
  StatStripSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import { EmptyPortfolio } from "@/components/dashboard/EmptyPortfolio";
import { PortfolioStatCards } from "@/components/portfolio/PortfolioStatCards";
import {
  PortfolioFilters,
  DEFAULT_FILTER,
  type HoldingsFilter,
} from "@/components/portfolio/PortfolioFilters";
import { HoldingsTable } from "@/components/portfolio/HoldingsTable";
import { DeletePositionDialog } from "@/components/portfolio/DeletePositionDialog";
import { AddPositionPanel } from "@/components/panels/AddPositionPanel";
import { EditPositionPanel } from "@/components/panels/EditPositionPanel";

function PortfolioError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border bg-surface-high px-6 py-20 text-center">
      <p className="text-sm font-semibold text-fg">
        Couldn&apos;t load your holdings
      </p>
      <p className="mt-1 max-w-sm text-xs text-fg-muted">{message}</p>
      <Button variant="secondary" className="mt-5" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

export default function PortfolioPage() {
  const {
    rows,
    stats,
    sectors,
    displayCurrency,
    hasPositions,
    isLoadingPositions,
    positionsError,
    isFetchingQuotes,
    hasStaleQuotes,
    refetch,
  } = usePortfolio();

  const openAddPanel = useUiStore((s) => s.openAddPanel);
  const [filter, setFilter] = useState<HoldingsFilter>(DEFAULT_FILTER);
  const [toDelete, setToDelete] = useState<PortfolioRow | null>(null);

  const filtered = useMemo(() => {
    const q = filter.query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter.exchange !== "ALL" && r.exchange !== filter.exchange)
        return false;
      if (filter.country !== "ALL" && r.country !== filter.country)
        return false;
      if (
        filter.sector !== "ALL" &&
        (r.sector?.trim() ?? "") !== filter.sector
      )
        return false;
      if (q) {
        const hay = `${r.ticker} ${r.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-fg-muted">
            Terminal / Portfolio
          </p>
          <h1 className="font-display text-2xl font-bold text-fg">
            Holdings Management
          </h1>
        </div>
        <Button onClick={() => openAddPanel()}>
          <Plus className="h-4 w-4" />
          Add Position
        </Button>
      </div>

      {positionsError ? (
        <PortfolioError
          message={positionsError.message}
          onRetry={refetch}
        />
      ) : isLoadingPositions ? (
        <>
          <StatStripSkeleton count={4} />
          <TableSkeleton rows={6} columns={8} />
        </>
      ) : !hasPositions ? (
        <EmptyPortfolio />
      ) : (
        <>
          {(isFetchingQuotes || hasStaleQuotes) && (
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
              {isFetchingQuotes ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Fetching live prices — values are provisional
                </>
              ) : (
                <>Showing last cached prices for some holdings</>
              )}
            </p>
          )}

          <PortfolioStatCards
            stats={stats}
            displayCurrency={displayCurrency}
          />

          <PortfolioFilters
            filter={filter}
            onChange={setFilter}
            sectors={sectors}
          />

          <HoldingsTable
            rows={filtered}
            totalRowCount={rows.length}
            displayCurrency={displayCurrency}
            onDelete={setToDelete}
          />
        </>
      )}

      {/* Slide-in panels + delete confirmation (mounted once). */}
      <AddPositionPanel />
      <EditPositionPanel rows={rows} />
      <DeletePositionDialog
        row={toDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
