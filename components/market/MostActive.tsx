"use client";

// Section 4 — Most Active by volume (PDR §5.5 §4). The spec wants US and TSX
// side by side; Twelve Data's free tier has no TSX most-active feed, so
// `/api/active` returns `caAvailable: false` (documented Stage 4/5). We render
// the US list and label the TSX column as unavailable on the data plan rather
// than silently dropping it.
import { useActiveQuery } from "@/lib/hooks/useMarket";
import { CardSkeleton } from "@/components/skeletons";
import {
  SectionHeader,
  StaleNote,
  SectionError,
  MoverListCard,
} from "@/components/market/shared";

export function MostActive() {
  const { data, isLoading, isError, refetch } = useActiveQuery();

  return (
    <section>
      <SectionHeader title="Most Active" note="By volume" />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      ) : isError || !data ? (
        <SectionError label="Most active" onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MoverListCard
              title="United States"
              rows={data.us.slice(0, 10)}
              metric="volume"
              emptyLabel="No active symbols reported."
            />
            <MoverListCard
              title="Canada (TSX)"
              rows={data.ca.slice(0, 10)}
              metric="volume"
              emptyLabel={
                data.caAvailable
                  ? "No active symbols reported."
                  : "TSX most-active is not available on the current data plan."
              }
            />
          </div>
          <StaleNote show={data.stale} />
        </>
      )}
    </section>
  );
}
