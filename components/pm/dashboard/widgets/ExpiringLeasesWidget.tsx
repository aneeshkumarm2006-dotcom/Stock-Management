"use client";

// Expiring Leases widget — Dashboard (PROPERTY_TODO.md Phase 10). 4 tabs by
// expiry window + a tiny stacked bar chart of pipeline stages (Not started /
// Offers / Renewals / Move-outs). Default tab = 0-30 days (most urgent).
import * as React from "react";
import { WidgetCard } from "../WidgetCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Bucket = "d0_30" | "d31_60" | "d61_90" | "all";

interface Payload {
  leaseStages: {
    notStarted: number;
    offers: number;
    renewals: number;
    moveOuts: number;
  };
  expiringByWindow: {
    d0_30: number;
    d31_60: number;
    d61_90: number;
    all: number;
  };
}

const BUCKET_LABELS: Record<Bucket, string> = {
  d0_30: "0-30",
  d31_60: "31-60",
  d61_90: "61-90",
  all: "All",
};

const URL_BY_BUCKET: Record<Bucket, string> = {
  d0_30: "0-30",
  d31_60: "31-60",
  d61_90: "61-90",
  all: "all",
};

const STAGE_COLORS = {
  notStarted: "rgb(var(--surface-highest))",
  offers: "rgb(var(--tertiary))",
  renewals: "rgb(var(--primary))",
  moveOuts: "rgb(var(--error))",
};

function StageBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max === 0 ? 0 : (value / max) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="font-semibold tabular-nums text-fg">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-surface-low">
        <div
          className="h-full transition-[width]"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function ExpiringLeasesWidget() {
  const [tab, setTab] = React.useState<Bucket>("d0_30");
  const [data, setData] = React.useState<Payload | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/rentals-summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d as Payload);
      })
      .catch(() => {
        /* swallow */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const windowCount = data?.expiringByWindow[tab] ?? 0;
  const stages = data?.leaseStages;
  const max = stages
    ? Math.max(stages.notStarted, stages.offers, stages.renewals, stages.moveOuts, 1)
    : 1;

  return (
    <WidgetCard
      title="Expiring Leases"
      tabs={
        <Tabs value={tab} onValueChange={(v) => setTab(v as Bucket)}>
          <TabsList>
            {(Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => (
              <TabsTrigger key={b} value={b}>
                {BUCKET_LABELS[b]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      viewAllHref="/properties/rentals/rent-roll"
      viewAllParams={{ expiring: URL_BY_BUCKET[tab] }}
      footer={
        windowCount > 0
          ? `${windowCount} lease${windowCount === 1 ? "" : "s"}`
          : null
      }
    >
      {!stages ? null : windowCount === 0 ? (
        <p className="text-sm text-fg-muted">No leases expiring.</p>
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          <StageBar
            label="Not started"
            value={stages.notStarted}
            max={max}
            color={STAGE_COLORS.notStarted}
          />
          <StageBar
            label="Offers"
            value={stages.offers}
            max={max}
            color={STAGE_COLORS.offers}
          />
          <StageBar
            label="Renewals"
            value={stages.renewals}
            max={max}
            color={STAGE_COLORS.renewals}
          />
          <StageBar
            label="Move-outs"
            value={stages.moveOuts}
            max={max}
            color={STAGE_COLORS.moveOuts}
          />
        </div>
      )}
    </WidgetCard>
  );
}

export default ExpiringLeasesWidget;
