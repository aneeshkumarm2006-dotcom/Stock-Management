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
  DEFAULT_OPTIONAL_COLUMNS,
  type HoldingsFilter,
  type OptionalColumn,
} from "@/components/portfolio/PortfolioFilters";
import { HoldingsTable } from "@/components/portfolio/HoldingsTable";
import { DeletePositionDialog } from "@/components/portfolio/DeletePositionDialog";
import { AddPositionPanel } from "@/components/panels/AddPositionPanel";
import { EditPositionPanel } from "@/components/panels/EditPositionPanel";
import { PageHead } from "@/components/layout/PageHead";

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
    summary,
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
  const [optionalColumns, setOptionalColumns] =
    useState<Record<OptionalColumn, boolean>>(DEFAULT_OPTIONAL_COLUMNS);
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

  // Per-exchange counts for the filter pills — derived from the unfiltered
  // row set so the pills always reflect the user's true distribution.
  // Positions can now sit on any global venue (LSE, XETRA, HKEX, …) so the
  // map is open-ended; the filter UI keeps the legacy NA pills as primary.
  const exchangeCounts = useMemo(() => {
    const counts: Record<string, number> = { NYSE: 0, NASDAQ: 0, TSX: 0 };
    for (const r of rows) counts[r.exchange] = (counts[r.exchange] ?? 0) + 1;
    return counts;
  }, [rows]);

  const distinctExchanges = (["NASDAQ", "NYSE", "TSX"] as const).filter(
    (id) => (exchangeCounts[id] ?? 0) > 0,
  ).length;

  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Portfolio"
        subtitle={
          rows.length > 0
            ? `${rows.length} active ${rows.length === 1 ? "holding" : "holdings"}${distinctExchanges > 0 ? ` · across ${distinctExchanges} ${distinctExchanges === 1 ? "exchange" : "exchanges"}` : ""}`
            : "Filter, sort, edit, and value every position in your portfolio"
        }
        actions={
          <Button onClick={() => openAddPanel()}>
            <Plus className="h-[13px] w-[13px]" />
            Add holding
          </Button>
        }
      />

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
      ) : !hasPositions || !summary ? (
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

          <PortfolioStatCards summary={summary} />

          <PortfolioFilters
            filter={filter}
            onChange={setFilter}
            sectors={sectors}
            exchangeCounts={exchangeCounts}
            optionalColumns={optionalColumns}
            onOptionalColumnsChange={setOptionalColumns}
          />

          <HoldingsTable
            rows={filtered}
            totalRowCount={rows.length}
            displayCurrency={displayCurrency}
            optionalColumns={optionalColumns}
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
