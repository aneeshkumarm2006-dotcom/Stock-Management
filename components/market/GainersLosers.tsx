"use client";

// Section 2 — Gainers & Losers (PDR §5.5 §2). The spec asks for Large / Mid /
// Small cap tiers; Twelve Data's free movers feed carries no market-cap field
// so `/api/movers` returns `capTiersAvailable: false` (documented Stage 4/5
// free-tier limitation). We render the top 5 gainers and top 5 losers and
// label the cap-tier limitation honestly rather than fabricating tiers.
import { useMoversQuery } from "@/lib/hooks/useMarket";
import { CardSkeleton } from "@/components/skeletons";
import {
  SectionHeader,
  StaleNote,
  SectionError,
  MoverListCard,
} from "@/components/market/shared";

const TOP = 5;

export function GainersLosers() {
  const { data, isLoading, isError, refetch } = useMoversQuery();

  return (
    <section>
      <SectionHeader
        title="Gainers & Losers"
        note={
          data && !data.capTiersAvailable
            ? "US market · cap-tier segmentation unavailable on the data plan — showing the overall top 5"
            : "US market"
        }
      />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      ) : isError || !data ? (
        <SectionError
          label="Gainers & losers"
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MoverListCard
              title="Top Gainers"
              rows={data.gainers.slice(0, TOP)}
              emptyLabel="No gainers reported."
            />
            <MoverListCard
              title="Top Losers"
              rows={data.losers.slice(0, TOP)}
              emptyLabel="No losers reported."
            />
          </div>
          <StaleNote show={data.stale} />
        </>
      )}
    </section>
  );
}
