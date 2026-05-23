// /properties/rentals/rent-roll — list view of leases.
// Default filter `(2) Active, Future` (BR-LL-2). EVICTION PENDING overlay
// renders as a red row decoration (BR-LL-3). 90-day orange chip on
// daysRemaining (BR-LL-5).
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { LEASE_STATUSES, type LeaseStatus } from "@/types/pm";

// Dashboard widgets deep-link with these query params (PROPERTY_TODO.md
// Phase 10 [G-B-12]). Both filters are client-side overlays on top of the
// `daysRemaining` field the leases endpoint already returns.
type ExpiringWindow = "0-30" | "31-60" | "61-90" | "all";
type InsuranceWindow = "expired" | "0-30" | "31-60" | "61-90";
const EXPIRING_WINDOWS = new Set<ExpiringWindow>([
  "0-30",
  "31-60",
  "61-90",
  "all",
]);
const INSURANCE_WINDOWS = new Set<InsuranceWindow>([
  "expired",
  "0-30",
  "31-60",
  "61-90",
]);

function inExpiringWindow(
  daysRemaining: number | null,
  win: ExpiringWindow,
): boolean {
  if (win === "all") return daysRemaining != null;
  if (daysRemaining == null || daysRemaining < 0) return false;
  if (win === "0-30") return daysRemaining <= 30;
  if (win === "31-60") return daysRemaining > 30 && daysRemaining <= 60;
  return daysRemaining > 60 && daysRemaining <= 90;
}

interface LeaseRow {
  id: string;
  leaseNumber: number;
  propertyId: string;
  unitId: string;
  tenants: Array<{ tenantId: string; firstName: string; lastName: string }>;
  leaseType: string;
  startDate: string;
  endDate: string | null;
  status: LeaseStatus;
  evictionPending: boolean;
  primaryRentAmount: number;
  securityDepositHeld: number;
  daysRemaining: number | null;
}

export default function RentRollPage() {
  const searchParams = useSearchParams();
  const expiringParam = searchParams.get("expiring");
  const insuranceParam = searchParams.get("insurance");
  const expiringWindow: ExpiringWindow | null = EXPIRING_WINDOWS.has(
    expiringParam as ExpiringWindow,
  )
    ? (expiringParam as ExpiringWindow)
    : null;
  const insuranceWindow: InsuranceWindow | null = INSURANCE_WINDOWS.has(
    insuranceParam as InsuranceWindow,
  )
    ? (insuranceParam as InsuranceWindow)
    : null;

  const [rows, setRows] = React.useState<LeaseRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] =
    React.useState<"Active,Future" | LeaseStatus | "all">("Active,Future");
  const [search, setSearch] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    const r = await fetch(`/api/pm/leases?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as LeaseRow[]);
    setLoading(false);
  }, [statusFilter]);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = React.useMemo(() => {
    let r = rows;
    if (expiringWindow) {
      r = r.filter((l) => inExpiringWindow(l.daysRemaining, expiringWindow));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (row) =>
          String(row.leaseNumber).includes(q) ||
          row.tenants.some((t) =>
            (t.firstName + " " + t.lastName).toLowerCase().includes(q),
          ),
      );
    }
    return r;
  }, [rows, search, expiringWindow]);

  return (
    <div className="space-y-4">
      {(expiringWindow || insuranceWindow) && (
        <div className="rounded border border-primary/40 bg-primary/5 px-4 py-2 text-xs text-fg">
          Dashboard filter applied:
          {expiringWindow && (
            <span className="ml-2 font-bold">
              Expiring {expiringWindow === "all" ? "(all windows)" : `${expiringWindow} days`}
            </span>
          )}
          {insuranceWindow && (
            <span className="ml-2 font-bold">
              Insurance:{" "}
              {insuranceWindow === "expired" ? "Expired" : `${insuranceWindow} days`}
            </span>
          )}
          <Link href="/properties/rentals/rent-roll" className="ml-3 text-primary hover:underline">
            Clear
          </Link>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Rent roll</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="leases">
            <TabsList>
              <TabsTrigger value="leases">Leases</TabsTrigger>
              <TabsTrigger value="liability">Liability management</TabsTrigger>
            </TabsList>

            <TabsContent value="leases" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setStatusFilter("Active,Future")}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-bold " +
                    (statusFilter === "Active,Future"
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-border bg-surface text-fg-muted")
                  }
                >
                  Active + Future <Badge variant="muted" className="ml-1.5">{rows.length}</Badge>
                </button>
                {LEASE_STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      "rounded-full border px-3 py-1 text-xs font-bold " +
                      (statusFilter === s
                        ? "border-primary bg-primary text-primary-fg"
                        : "border-border bg-surface text-fg-muted")
                    }
                  >
                    {s}
                  </button>
                ))}
                <button
                  onClick={() => setStatusFilter("all")}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-bold " +
                    (statusFilter === "all"
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-border bg-surface text-fg-muted")
                  }
                >
                  All
                </button>
                <div className="ml-auto w-full max-w-xs">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search leases or tenants"
                  />
                </div>
              </div>

              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                  <tr>
                    <th className="py-2">Lease #</th>
                    <th>Tenants</th>
                    <th>Type</th>
                    <th>Term</th>
                    <th>Rent</th>
                    <th>Deposit held</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} className="py-4 text-fg-muted">
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-4 text-fg-muted">
                        No leases match.
                      </td>
                    </tr>
                  )}
                  {filtered.map((l) => (
                    <tr
                      key={l.id}
                      className={
                        "border-b border-border/40 " +
                        (l.evictionPending
                          ? "bg-loss/10 border-l-2 border-loss"
                          : "")
                      }
                    >
                      <td className="py-2">
                        <Link
                          href={`/properties/rentals/rent-roll/${l.id}`}
                          className="font-medium hover:underline"
                        >
                          #{l.leaseNumber}
                        </Link>
                        {l.evictionPending && (
                          <Badge variant="loss" className="ml-2">
                            EVICTION PENDING
                          </Badge>
                        )}
                      </td>
                      <td className="text-fg-muted">
                        {l.tenants
                          .map((t) => `${t.firstName} ${t.lastName}`)
                          .join(", ") || "—"}
                      </td>
                      <td className="text-fg-muted">{l.leaseType}</td>
                      <td className="text-fg-muted">
                        {new Date(l.startDate).toLocaleDateString()} →{" "}
                        {l.endDate
                          ? new Date(l.endDate).toLocaleDateString()
                          : "(At-will)"}
                        {l.daysRemaining != null && (
                          <Badge variant="loss" className="ml-2">
                            {l.daysRemaining}d
                          </Badge>
                        )}
                      </td>
                      <td>
                        <CurrencyAmount cents={l.primaryRentAmount} />
                      </td>
                      <td>
                        <CurrencyAmount cents={l.securityDepositHeld} />
                      </td>
                      <td>
                        <Badge
                          variant={
                            l.status === "Active"
                              ? "gain"
                              : l.status === "Future"
                                ? "muted"
                                : l.status === "Expired"
                                  ? "loss"
                                  : "outline"
                          }
                        >
                          {l.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-fg-muted">
                Match count: {filtered.length} of {rows.length} loaded.
              </p>
            </TabsContent>

            <TabsContent value="liability">
              <p className="text-sm text-fg-muted">
                Liability management view (security deposit roll-up — BR-LL-4)
                will surface here once Phase 9 reconciliation lands.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
