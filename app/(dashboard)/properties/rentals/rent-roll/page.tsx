// /properties/rentals/rent-roll — list view of leases.
// Default filter `(2) Active, Future` (BR-LL-2). EVICTION PENDING overlay
// renders as a red row decoration (BR-LL-3). 90-day orange chip on
// daysRemaining (BR-LL-5).
//
// CURRENCY. This list mixes US and Canadian leases, so a single display
// currency is wrong for at least one of them: a US lease billed at $6,556 is
// $6,556 whichever way the top-bar toggle is set, and converting it produces a
// figure that matches no lease document. Each row therefore renders in its own
// property's currency (`convert={false}`) and is tagged in the Cur column. The
// only figure on this page that follows the toggle is the grand total, which
// genuinely spans currencies and converts via MoneyTotal.
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { MoneyTotal } from "@/components/pm/MoneyTotal";
import {
  LEASE_STATUSES,
  type LeaseStatus,
  type TenantType,
  type PmCurrency,
} from "@/types/pm";
import { tenantDisplayName } from "@/lib/pm/tenantName";
import { formatDateOnly } from "@/lib/utils/dateInput";
import { compareCountryGroups } from "@/lib/pm/country";
import { addMoney, type MoneyByCurrency } from "@/lib/pm/moneyByCurrency";

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

// Fix 13 — match a lease's renters-insurance expiry (days until the soonest
// policy expires; undefined when the lease has no expiring/expired policy in
// the rollup) against the deep-linked insurance window.
function inInsuranceWindow(
  daysUntil: number | undefined,
  win: InsuranceWindow,
): boolean {
  if (daysUntil == null) return false;
  if (win === "expired") return daysUntil < 0;
  if (daysUntil < 0) return false;
  if (win === "0-30") return daysUntil <= 30;
  if (win === "31-60") return daysUntil > 30 && daysUntil <= 60;
  return daysUntil > 60 && daysUntil <= 90;
}

// How the table separates rows. "currency" is the default — see the state
// declaration for why. Mirrors PropertyGroupBy on the properties list.
type LeaseGroupBy = "none" | "currency" | "country";

const GROUP_BY_LABEL: Record<LeaseGroupBy, string> = {
  none: "No grouping",
  currency: "Group by currency",
  country: "Group by country",
};

/** USD before CAD, so the sections keep the old US-then-Canada reading order. */
function compareCurrencyGroups(a: string, b: string): number {
  const rank = (c: string) => (c === "USD" ? 0 : c === "CAD" ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** Lease #, Tenants, Type, Term, Cur, Rent, Deposit held, Status. */
const COL_COUNT = 8;

/**
 * A subtotal that only converts when it has to.
 *
 * A currency group's subtotal is single-currency by construction and must stay
 * in that currency — converting it would reintroduce the bug one level up from
 * the rows. A country group's subtotal genuinely can span currencies (a
 * property's currency is its own field, not derived from its address), so that
 * one converts and picks up MoneyTotal's stale-FX warning.
 *
 * `fallbackCurrency` covers the all-zero case: with no non-zero bucket there is
 * nothing to infer a currency from, and without it a USD group's zero deposits
 * would render as `C$0.00` under the CAD toggle.
 */
function GroupMoney({
  totals,
  fallbackCurrency,
}: {
  totals: MoneyByCurrency;
  fallbackCurrency?: PmCurrency;
}) {
  const present = (Object.keys(totals) as PmCurrency[]).filter(
    (c) => (totals[c] ?? 0) !== 0,
  );
  const only = present.length === 1 ? present[0] : undefined;
  const native = only ?? (present.length === 0 ? fallbackCurrency : undefined);
  if (native) {
    return (
      <CurrencyAmount
        cents={totals[native] ?? 0}
        currency={native}
        convert={false}
      />
    );
  }
  return <MoneyTotal totals={totals} />;
}

/** A currency group's label IS its currency; a country group's is not. */
const isPmCurrencyLabel = (s: string): s is PmCurrency =>
  s === "USD" || s === "CAD";

interface LeaseRow {
  id: string;
  leaseNumber: number;
  propertyId: string;
  /** Normalized country of the lease's property ("United States" | "Canada" |
   *  "Other"), for the US/CAN separation. */
  country: string;
  /** Booking currency of the lease's property. Resolved server-side, so this is
   *  always concrete — never null, never inferred from `country` (a property's
   *  currency is its own field). */
  currency: PmCurrency;
  unitId: string;
  tenants: Array<{
    tenantId: string;
    tenantType?: TenantType;
    firstName: string;
    lastName: string;
    companyName?: string;
  }>;
  leaseType: string;
  startDate: string;
  endDate: string | null;
  status: LeaseStatus;
  evictionPending: boolean;
  primaryRentAmount: number;
  /** §4 — Base Rent + OPEX/Tax recovery splits. */
  totalRentAmount: number;
  securityDepositHeld: number;
  daysRemaining: number | null;
}

export default function RentRollPage() {
  return (
    <React.Suspense fallback={<div className="text-sm text-fg-muted">Loading…</div>}>
      <RentRollPageInner />
    </React.Suspense>
  );
}

function RentRollPageInner() {
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

  const { toast } = useToast();
  const [rows, setRows] = React.useState<LeaseRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [reconciling, setReconciling] = React.useState(false);
  const [statusFilter, setStatusFilter] =
    React.useState<"Active,Future" | LeaseStatus | "all">("Active,Future");
  const [search, setSearch] = React.useState("");
  // The client operates in the US and Canada and wants leases separated. Group
  // by currency by default — that is the split that changes what the numbers
  // MEAN, and it is the one the per-group subtotals can legitimately add up.
  // Country grouping stays available: a country group is not automatically
  // single-currency, since a property's currency is its own field.
  const [groupBy, setGroupBy] = React.useState<LeaseGroupBy>("currency");

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    // "all" must enumerate every status explicitly. Omitting `status` triggers
    // the BR-LL-2 server default (Active+Future only), which would silently
    // narrow the "All" chip. See Fix 12.
    if (statusFilter !== "all") params.set("status", statusFilter);
    else params.set("status", LEASE_STATUSES.join(","));
    const r = await fetch(`/api/pm/leases?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as LeaseRow[]);
    setLoading(false);
  }, [statusFilter]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Stopgap for stale persisted statuses: a lease that lapsed by date keeps its
  // last-written `status`/`currentLeaseId` until a lease write (or the nightly
  // cron) reconciles it — which can make tenant/unit assignment falsely fail.
  // This button reconciles the whole org on demand, then reloads the table.
  const reconcileStatuses = React.useCallback(async () => {
    setReconciling(true);
    try {
      const r = await fetch("/api/pm/leases/reconcile-statuses", {
        method: "POST",
      });
      const data = (await r.json().catch(() => ({}))) as {
        updated?: number;
        tenantsTouched?: number;
        error?: string;
      };
      if (!r.ok) {
        toast({
          title: "Reconcile failed",
          description: data.error ?? "Try again.",
          variant: "error",
        });
        return;
      }
      toast({
        title: "Statuses reconciled",
        description: `${data.updated ?? 0} lease(s) updated, ${
          data.tenantsTouched ?? 0
        } tenant link(s) corrected.`,
        variant: "success",
      });
      await load();
    } finally {
      setReconciling(false);
    }
  }, [toast, load]);

  // Fix 13 — the `?insurance=` deep link was banner-only and never filtered the
  // table. We fetch the org-wide renters-insurance rollup in parallel and build
  // a leaseId → daysUntil map from the expiring/expired policies it returns,
  // then apply a real `insuranceWindow` filter in `filtered` below so the table
  // matches the banner.
  // TODO(fix-13): the rollup endpoint only returns the top ~10 expiring
  // policies (expiringPolicies), so for large orgs the insurance filter is
  // bounded by that slice. Expose per-lease policy-expiry on the leases list
  // endpoint to make this exhaustive.
  const [insuranceDays, setInsuranceDays] = React.useState<
    Map<string, number>
  >(new Map());

  React.useEffect(() => {
    if (!insuranceWindow) return;
    let cancelled = false;
    fetch("/api/pm/renters-insurance")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data: {
        expiringPolicies?: Array<{ leaseId: string; daysUntil: number }>;
      } | null) => {
        if (cancelled || !data?.expiringPolicies) return;
        const m = new Map<string, number>();
        for (const p of data.expiringPolicies) {
          // Keep the soonest-expiring policy per lease.
          const prev = m.get(p.leaseId);
          if (prev == null || p.daysUntil < prev) m.set(p.leaseId, p.daysUntil);
        }
        setInsuranceDays(m);
      });
    return () => {
      cancelled = true;
    };
  }, [insuranceWindow]);

  const filtered = React.useMemo(() => {
    let r = rows;
    if (expiringWindow) {
      r = r.filter((l) => inExpiringWindow(l.daysRemaining, expiringWindow));
    }
    if (insuranceWindow) {
      r = r.filter((l) =>
        inInsuranceWindow(insuranceDays.get(l.id), insuranceWindow),
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (row) =>
          String(row.leaseNumber).includes(q) ||
          row.tenants.some((t) =>
            tenantDisplayName(t).toLowerCase().includes(q),
          ),
      );
    }
    return r;
  }, [rows, search, expiringWindow, insuranceWindow, insuranceDays]);

  // Group the visible rows by currency (USD then CAD, preserving the old
  // US-then-Canada reading order) or by property country (US → Canada → others
  // → Other, mirroring the dashboard Outstanding Balances widget).
  //
  // Each group carries currency-tagged totals rather than a bare number: a
  // COUNTRY group can legitimately hold both currencies, so summing its rows
  // into one figure would be exactly the bug this page is fixing.
  const groups = React.useMemo(() => {
    if (groupBy === "none") return [];
    const m = new Map<string, LeaseRow[]>();
    for (const l of filtered) {
      const key = groupBy === "currency" ? l.currency : l.country || "Other";
      const list = m.get(key) ?? [];
      list.push(l);
      m.set(key, list);
    }
    return Array.from(m.entries())
      .map(([label, groupRows]) => ({
        label,
        rows: groupRows,
        rentTotals: groupRows.reduce<MoneyByCurrency>(
          (acc, l) =>
            addMoney(acc, l.currency, l.totalRentAmount ?? l.primaryRentAmount),
          {},
        ),
        depositTotals: groupRows.reduce<MoneyByCurrency>(
          (acc, l) => addMoney(acc, l.currency, l.securityDepositHeld),
          {},
        ),
      }))
      .sort((a, b) =>
        groupBy === "currency"
          ? compareCurrencyGroups(a.label, b.label)
          : compareCountryGroups(a.label, b.label),
      );
  }, [filtered, groupBy]);

  // Grand totals across every visible lease — the one figure on this page that
  // genuinely spans currencies, and therefore the one that follows the toggle.
  const grandRentTotals = React.useMemo(
    () =>
      filtered.reduce<MoneyByCurrency>(
        (acc, l) =>
          addMoney(acc, l.currency, l.totalRentAmount ?? l.primaryRentAmount),
        {},
      ),
    [filtered],
  );
  const grandDepositTotals = React.useMemo(
    () =>
      filtered.reduce<MoneyByCurrency>(
        (acc, l) => addMoney(acc, l.currency, l.securityDepositHeld),
        {},
      ),
    [filtered],
  );

  const renderLeaseRow = (l: LeaseRow) => (
    <tr
      key={l.id}
      className={
        "border-b border-border/40 " +
        (l.evictionPending ? "bg-loss/10 border-l-2 border-loss" : "")
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
        {l.tenants.map((t) => tenantDisplayName(t)).join(", ") || "—"}
      </td>
      <td className="text-fg-muted">{l.leaseType}</td>
      <td className="text-fg-muted">
        {formatDateOnly(l.startDate)} →{" "}
        {l.endDate ? formatDateOnly(l.endDate) : "(At-will)"}
        {l.daysRemaining != null && (
          <Badge variant="loss" className="ml-2">
            {l.daysRemaining}d
          </Badge>
        )}
      </td>
      <td>
        <Badge variant="outline">{l.currency}</Badge>
      </td>
      <td>
        <CurrencyAmount
          cents={l.totalRentAmount ?? l.primaryRentAmount}
          currency={l.currency}
          convert={false}
        />
        {(l.totalRentAmount ?? l.primaryRentAmount) > l.primaryRentAmount && (
          <div className="text-xs text-fg-muted">
            Base{" "}
            <CurrencyAmount
              cents={l.primaryRentAmount}
              currency={l.currency}
              convert={false}
            />
          </div>
        )}
      </td>
      <td>
        <CurrencyAmount
          cents={l.securityDepositHeld}
          currency={l.currency}
          convert={false}
        />
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
  );

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
                <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                {(["currency", "country", "none"] as LeaseGroupBy[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={
                      "rounded-full border px-3 py-1 text-xs font-bold " +
                      (groupBy === g
                        ? "border-primary bg-primary text-primary-fg"
                        : "border-border bg-surface text-fg-muted")
                    }
                    title={
                      g === "currency"
                        ? "Separate leases into USD and CAD sections, each with its own subtotal"
                        : g === "country"
                          ? "Separate leases into United States and Canada sections"
                          : "One flat list"
                    }
                  >
                    {GROUP_BY_LABEL[g]}
                  </button>
                ))}
                <div className="ml-auto flex w-full max-w-md items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={reconcileStatuses}
                    disabled={reconciling}
                    title="Refresh lease statuses and tenant assignment links from today's date. Fixes expired leases that still block a unit or tenant from being reassigned."
                  >
                    {reconciling ? "Reconciling…" : "Reconcile statuses"}
                  </Button>
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
                    <th title="Currency this lease is billed in — the currency of its property">
                      Cur
                    </th>
                    <th>Rent</th>
                    <th>Deposit held</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={COL_COUNT} className="py-4 text-fg-muted">
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={COL_COUNT} className="py-4 text-fg-muted">
                        No leases match.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    filtered.length > 0 &&
                    (groupBy === "none"
                      ? filtered.map(renderLeaseRow)
                      : groups.map((g) => (
                          <React.Fragment key={g.label}>
                            <tr className="bg-surface-high/40">
                              <td
                                colSpan={COL_COUNT}
                                className="py-1.5 text-xs font-bold uppercase tracking-widest text-fg-muted"
                              >
                                {g.label}
                                <span className="ml-2 font-normal normal-case tracking-normal">
                                  {g.rows.length} lease
                                  {g.rows.length === 1 ? "" : "s"}
                                </span>
                              </td>
                            </tr>
                            {g.rows.map(renderLeaseRow)}
                            <tr className="border-b border-border/60 text-xs font-bold">
                              <td className="py-1.5 text-fg-muted" colSpan={4}>
                                {g.label} subtotal
                              </td>
                              <td />
                              <td>
                                <GroupMoney
                                  totals={g.rentTotals}
                                  fallbackCurrency={
                                    isPmCurrencyLabel(g.label)
                                      ? g.label
                                      : undefined
                                  }
                                />
                              </td>
                              <td>
                                <GroupMoney
                                  totals={g.depositTotals}
                                  fallbackCurrency={
                                    isPmCurrencyLabel(g.label)
                                      ? g.label
                                      : undefined
                                  }
                                />
                              </td>
                              <td />
                            </tr>
                          </React.Fragment>
                        )))}
                </tbody>
                {!loading && filtered.length > 0 && (
                  <tfoot className="border-t-2 border-border text-sm font-bold">
                    <tr>
                      <td className="py-2" colSpan={4}>
                        All leases
                      </td>
                      <td />
                      <td>
                        <MoneyTotal totals={grandRentTotals} />
                      </td>
                      <td>
                        <MoneyTotal totals={grandDepositTotals} />
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
              <p className="text-xs text-fg-muted">
                Match count: {filtered.length} of {rows.length} loaded. Each
                lease shows the currency it is billed in and does not change
                when you switch the display currency — only the totals convert.
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
