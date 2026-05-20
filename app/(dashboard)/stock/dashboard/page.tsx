"use client";

// Dashboard — portfolio overview (PDR §5.2, §9, §10).
// Layout mirrors site/design/dashboard: index strip → top stat strip →
// allocation donut (4 cols) + Top Holdings (8 cols). Every monetary figure
// is converted to the display currency before aggregation (computePortfolio,
// PDR §9); the USD/CAD toggle lives in the TopBar (Stage 6) and reflows the
// whole page reactively via the Settings store.
import { RefreshCw } from "lucide-react";
import { useDashboardData } from "@/lib/hooks/useDashboard";
import { IndexStrip } from "@/components/dashboard/IndexStrip";
import { StatStrip } from "@/components/dashboard/StatStrip";
import { AllocationCard } from "@/components/dashboard/AllocationCard";
import { TopHoldings } from "@/components/dashboard/TopHoldings";
import { EmptyPortfolio } from "@/components/dashboard/EmptyPortfolio";
import {
  StatStripSkeleton,
  CardSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import { Button } from "@/components/ui/button";

function DashboardError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border bg-surface-high px-6 py-20 text-center">
      <p className="text-sm font-semibold text-fg">
        Couldn&apos;t load your portfolio
      </p>
      <p className="mt-1 max-w-sm text-xs text-fg-muted">{message}</p>
      <Button variant="secondary" className="mt-5" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

export default function DashboardPage() {
  const {
    summary,
    holdings,
    displayCurrency,
    hasPositions,
    isLoadingPositions,
    positionsError,
    isFetchingQuotes,
    hasStaleQuotes,
    refetchPositions,
  } = useDashboardData();

  return (
    <div className="space-y-6">
      {/* Index strip — independent of the user's positions. */}
      <IndexStrip />

      {positionsError ? (
        <DashboardError
          message={positionsError.message}
          onRetry={refetchPositions}
        />
      ) : isLoadingPositions ? (
        <>
          <StatStripSkeleton count={5} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <CardSkeleton className="lg:col-span-4" lines={6} />
            <TableSkeleton
              className="lg:col-span-8"
              rows={6}
              columns={6}
            />
          </div>
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
                  Fetching live prices — totals are provisional
                </>
              ) : (
                <>Showing last cached prices for some holdings</>
              )}
            </p>
          )}

          <StatStrip summary={summary} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <AllocationCard summary={summary} />
            </div>
            <div className="lg:col-span-8">
              <TopHoldings
                holdings={holdings}
                displayCurrency={displayCurrency}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
