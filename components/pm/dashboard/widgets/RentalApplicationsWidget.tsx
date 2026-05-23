"use client";

// Rental Applications widget — Dashboard (PROPERTY_TODO.md Phase 10).
// 3 tabs (New / Screening / Approved) mapped onto Applicant.status. The
// underlying entity uses "Screening" as the undecided bucket — we surface
// it as "Undecided" to match the PDR mockup wording.
import * as React from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { WidgetCard } from "../WidgetCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabValue = "New" | "Screening" | "Approved";

interface ApplicantRow {
  id: string;
  displayName: string;
  status: string;
  unitId: string | null;
  applicationReceivedAt: string;
}

const TAB_LABELS: Record<TabValue, string> = {
  New: "New",
  Screening: "Undecided",
  Approved: "Approved",
};

function fetchApplicants(status: TabValue): Promise<ApplicantRow[]> {
  return fetch(`/api/pm/applicants?status=${encodeURIComponent(status)}&includeClosed=1`)
    .then((r) => (r.ok ? r.json() : []))
    .then((d) => (Array.isArray(d) ? (d as ApplicantRow[]) : []))
    .catch(() => []);
}

export function RentalApplicationsWidget() {
  const [tab, setTab] = React.useState<TabValue>("New");
  const [rows, setRows] = React.useState<ApplicantRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetchApplicants(tab).then((d) => {
      if (cancelled) return;
      setRows(d);
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const visible = rows?.slice(0, 4) ?? [];
  const total = rows?.length ?? 0;

  return (
    <WidgetCard
      title="Rental Applications"
      tabs={
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList>
            {(Object.keys(TAB_LABELS) as TabValue[]).map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      viewAllHref="/properties/leasing/applicants"
      viewAllParams={{ status: tab }}
      footer={total > 0 ? `Showing ${Math.min(total, 4)} of ${total}` : null}
    >
      {rows == null ? null : visible.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No {TAB_LABELS[tab].toLowerCase()} applications.
        </p>
      ) : (
        <ul className="flex flex-1 flex-col divide-y divide-border/60 text-sm">
          {visible.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 py-2"
            >
              <Link
                href={`/properties/leasing/applicants/${a.id}`}
                className="truncate font-semibold text-fg hover:text-primary"
              >
                {a.displayName}
              </Link>
              <span className="shrink-0 text-xs text-fg-muted">
                {formatDistanceToNowStrict(new Date(a.applicationReceivedAt), {
                  addSuffix: true,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export default RentalApplicationsWidget;
