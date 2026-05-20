"use client";

// Analytics — allocation & diversification (PDR §5.6, §9).
// Reuses the dashboard data layer: useDashboardData() already returns the
// currency-converted PortfolioSummary (allocation buckets + diversification)
// computed by computePortfolio, so every figure here is in the display
// currency and reflows reactively with the TopBar USD/CAD toggle (Stage 6).
// Layout follows PDR §5.6 order: diversification → sector → country/currency
// → P&L ranking → invested vs value.
import { RefreshCw } from "lucide-react";
import { useDashboardData } from "@/lib/hooks/useDashboard";
import { DiversificationCards } from "@/components/analytics/DiversificationCards";
import { SectorExposure } from "@/components/analytics/SectorExposure";
import { ExposureDonut } from "@/components/analytics/ExposureDonut";
import { PnlRanking } from "@/components/analytics/PnlRanking";
import { InvestedVsValue } from "@/components/analytics/InvestedVsValue";
import { EmptyPortfolio } from "@/components/dashboard/EmptyPortfolio";
import {
  StatStripSkeleton,
  CardSkeleton,
} from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { COUNTRY_LABEL, CURRENCY_LABEL } from "@/components/analytics/chartTheme";

function AnalyticsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border bg-surface-high px-6 py-20 text-center">
      <p className="text-sm font-semibold text-fg">
        Couldn&apos;t load analytics
      </p>
      <p className="mt-1 max-w-sm text-xs text-fg-muted">{message}</p>
      <Button variant="secondary" className="mt-5" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

export default function AnalyticsPage() {
  const {
    summary,
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
      <div>
        <h1 className="font-display text-2xl font-bold text-fg">Analytics</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Allocation, diversification and performance breakdown — all values in{" "}
          {displayCurrency}.
        </p>
      </div>

      {positionsError ? (
        <AnalyticsError
          message={positionsError.message}
          onRetry={refetchPositions}
        />
      ) : isLoadingPositions ? (
        <>
          <StatStripSkeleton count={3} />
          <CardSkeleton lines={6} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CardSkeleton lines={6} />
            <CardSkeleton lines={6} />
          </div>
          <CardSkeleton lines={6} />
          <CardSkeleton lines={6} />
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
                  Fetching live prices — figures are provisional
                </>
              ) : (
                <>Showing last cached prices for some holdings</>
              )}
            </p>
          )}

          <DiversificationCards summary={summary} />

          <SectorExposure summary={summary} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ExposureDonut
              title="Country Exposure"
              slices={summary.allocationByCountry}
              labelMap={COUNTRY_LABEL}
              displayCurrency={displayCurrency}
            />
            <ExposureDonut
              title="Currency Exposure"
              slices={summary.allocationByCurrency}
              labelMap={CURRENCY_LABEL}
              displayCurrency={displayCurrency}
            />
          </div>

          <PnlRanking summary={summary} />

          <InvestedVsValue summary={summary} />
        </>
      )}
    </div>
  );
}
