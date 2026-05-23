"use client";

// Expiring Renters Insurance widget — Dashboard (PROPERTY_TODO.md Phase 10).
// 4 tabs (Expired / 0-30 / 31-60 / 61-90 days). Default = Expired so the
// manager sees the most urgent bucket first (PDR §8.6).
import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { WidgetCard } from "../WidgetCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Bucket = "expired" | "d0_30" | "d31_60" | "d61_90";

interface Policy {
  id: string;
  leaseId: string;
  carrier: string;
  policyNumber: string;
  label: string;
  expirationDate: string;
  daysUntil: number;
}

interface Payload {
  expiring: {
    expired: number;
    days0_30: number;
    days31_60: number;
    days61_90: number;
  };
  expiringPolicies: Policy[];
}

const BUCKET_LABELS: Record<Bucket, string> = {
  expired: "Expired",
  d0_30: "0-30 days",
  d31_60: "31-60 days",
  d61_90: "61-90 days",
};

const URL_BY_BUCKET: Record<Bucket, string> = {
  expired: "expired",
  d0_30: "0-30",
  d31_60: "31-60",
  d61_90: "61-90",
};

function bucketMatch(p: Policy, b: Bucket): boolean {
  if (b === "expired") return p.daysUntil < 0;
  if (b === "d0_30") return p.daysUntil >= 0 && p.daysUntil <= 30;
  if (b === "d31_60") return p.daysUntil > 30 && p.daysUntil <= 60;
  return p.daysUntil > 60 && p.daysUntil <= 90;
}

export function ExpiringRentersInsuranceWidget() {
  const [tab, setTab] = React.useState<Bucket>("expired");
  const [data, setData] = React.useState<Payload | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/renters-insurance")
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

  const bucketCount = data
    ? tab === "expired"
      ? data.expiring.expired
      : tab === "d0_30"
        ? data.expiring.days0_30
        : tab === "d31_60"
          ? data.expiring.days31_60
          : data.expiring.days61_90
    : 0;
  const rows = (data?.expiringPolicies ?? []).filter((p) => bucketMatch(p, tab));

  return (
    <WidgetCard
      title="Expiring Renters Insurance"
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
      viewAllParams={{ insurance: URL_BY_BUCKET[tab] }}
      footer={bucketCount > 0 ? `${bucketCount} in window` : null}
    >
      {bucketCount === 0 ? (
        <p className="text-sm text-fg-muted">
          {tab === "expired"
            ? "There are no expired policies."
            : "No policies in this window."}
        </p>
      ) : (
        <ul className="flex flex-1 flex-col divide-y divide-border/60 text-sm">
          {rows.slice(0, 4).map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-2">
              <Link
                href={`/properties/leasing/lease-management/${p.leaseId}`}
                className="truncate font-semibold text-fg hover:text-primary"
                title={p.label}
              >
                {p.label}
              </Link>
              <span className="shrink-0 text-xs text-fg-muted">
                {format(new Date(p.expirationDate), "MMM d")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export default ExpiringRentersInsuranceWidget;
