"use client";

// Section 5 — 52-Week Highs / Lows (PDR §5.5 §5), tabbed US / TSX. The free
// tier has no 52-week highs/lows endpoint, so `/api/highs-lows` proxies the
// daily gainers (→ highs) / losers (→ lows) feeds and flags
// `approximation: true`; TSX movers are not on the free tier so `ca` is empty
// and flagged `caAvailable: false` (documented Stage 4/5). Both limitations
// are labeled honestly here.
import { useState } from "react";
import { useHighsLowsQuery } from "@/lib/hooks/useMarket";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CardSkeleton } from "@/components/skeletons";
import {
  SectionHeader,
  StaleNote,
  SectionError,
  MoverListCard,
} from "@/components/market/shared";

export function HighsLows() {
  const { data, isLoading, isError, refetch } = useHighsLowsQuery();
  const [tab, setTab] = useState<"us" | "ca">("us");

  return (
    <section>
      <SectionHeader
        title="52-Week Highs / Lows"
        note={
          data?.approximation
            ? "Approximated from daily gainers/losers on the current data plan"
            : undefined
        }
      />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      ) : isError || !data ? (
        <SectionError
          label="52-week highs/lows"
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "us" | "ca")}>
            <TabsList className="mb-3">
              <TabsTrigger value="us">United States</TabsTrigger>
              <TabsTrigger value="ca">Canada (TSX)</TabsTrigger>
            </TabsList>
            <TabsContent value="us">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <MoverListCard
                  title="52-Week Highs"
                  rows={data.us.highs.slice(0, 10)}
                  emptyLabel="No new highs reported."
                />
                <MoverListCard
                  title="52-Week Lows"
                  rows={data.us.lows.slice(0, 10)}
                  emptyLabel="No new lows reported."
                />
              </div>
            </TabsContent>
            <TabsContent value="ca">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <MoverListCard
                  title="52-Week Highs"
                  rows={data.ca.highs.slice(0, 10)}
                  emptyLabel={
                    data.caAvailable
                      ? "No new highs reported."
                      : "TSX highs/lows are not available on the current data plan."
                  }
                />
                <MoverListCard
                  title="52-Week Lows"
                  rows={data.ca.lows.slice(0, 10)}
                  emptyLabel={
                    data.caAvailable
                      ? "No new lows reported."
                      : "TSX highs/lows are not available on the current data plan."
                  }
                />
              </div>
            </TabsContent>
          </Tabs>
          <StaleNote show={data.stale} />
        </>
      )}
    </section>
  );
}
