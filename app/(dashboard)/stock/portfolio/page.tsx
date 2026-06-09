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
import { FixedIncomeTable } from "@/components/portfolio/FixedIncomeTable";
import { ManualHoldingsTable } from "@/components/portfolio/ManualHoldingsTable";
import { UpdateValueDialog } from "@/components/portfolio/UpdateValueDialog";
import { DeletePositionDialog } from "@/components/portfolio/DeletePositionDialog";
import { AddHoldingPanel } from "@/components/panels/add/AddHoldingPanel";
import { EditHoldingPanel } from "@/components/panels/EditHoldingPanel";
import { PageHead } from "@/components/layout/PageHead";

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <h2 className="font-display text-sm font-bold uppercase tracking-wider text-fg">
        {title}
      </h2>
      <span className="text-xs text-fg-muted">
        {count} {count === 1 ? "holding" : "holdings"}
      </span>
    </div>
  );
}

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
  const [toUpdateValue, setToUpdateValue] = useState<PortfolioRow | null>(null);

  // Split holdings into per-type sections. Equities keep the filterable table;
  // the rest get type-appropriate section tables.
  const equityRows = useMemo(
    () => rows.filter((r) => (r.assetType ?? "EQUITY") === "EQUITY"),
    [rows],
  );
  const fixedIncomeRows = useMemo(
    () => rows.filter((r) => r.assetType === "GIC" || r.assetType === "BOND"),
    [rows],
  );
  const mutualFundRows = useMemo(
    () => rows.filter((r) => r.assetType === "MUTUAL_FUND"),
    [rows],
  );
  const cashRows = useMemo(
    () => rows.filter((r) => r.assetType === "CASH"),
    [rows],
  );

  // Filters apply to the equities section only.
  const filtered = useMemo(() => {
    const q = filter.query.trim().toLowerCase();
    return equityRows.filter((r) => {
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
  }, [equityRows, filter]);

  // Per-exchange counts for the filter pills — derived from the unfiltered
  // equity rows so the pills always reflect the user's true distribution.
  const exchangeCounts = useMemo(() => {
    const counts: Record<string, number> = { NYSE: 0, NASDAQ: 0, TSX: 0 };
    for (const r of equityRows)
      counts[r.exchange] = (counts[r.exchange] ?? 0) + 1;
    return counts;
  }, [equityRows]);

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

          {/* Equities — the filterable/sortable table. */}
          {equityRows.length > 0 && (
            <>
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
                totalRowCount={equityRows.length}
                displayCurrency={displayCurrency}
                optionalColumns={optionalColumns}
                onDelete={setToDelete}
              />
            </>
          )}

          {/* Fixed income — GICs & Bonds. */}
          {fixedIncomeRows.length > 0 && (
            <>
              <SectionHeading title="Fixed income" count={fixedIncomeRows.length} />
              <FixedIncomeTable
                rows={fixedIncomeRows}
                displayCurrency={displayCurrency}
                onDelete={setToDelete}
              />
            </>
          )}

          {/* Private mutual funds — manual monthly value. */}
          {mutualFundRows.length > 0 && (
            <>
              <SectionHeading title="Mutual funds" count={mutualFundRows.length} />
              <ManualHoldingsTable
                rows={mutualFundRows}
                displayCurrency={displayCurrency}
                variant="MUTUAL_FUND"
                onDelete={setToDelete}
                onUpdateValue={setToUpdateValue}
              />
            </>
          )}

          {/* Cash & other manual holdings. */}
          {cashRows.length > 0 && (
            <>
              <SectionHeading title="Cash & other" count={cashRows.length} />
              <ManualHoldingsTable
                rows={cashRows}
                displayCurrency={displayCurrency}
                variant="CASH"
                onDelete={setToDelete}
              />
            </>
          )}
        </>
      )}

      {/* Slide-in panels + dialogs (mounted once). */}
      <AddHoldingPanel />
      <EditHoldingPanel rows={rows} />
      <DeletePositionDialog row={toDelete} onClose={() => setToDelete(null)} />
      <UpdateValueDialog
        row={toUpdateValue}
        onClose={() => setToUpdateValue(null)}
      />
    </div>
  );
}
