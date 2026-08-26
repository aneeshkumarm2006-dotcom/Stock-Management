// /properties/accounting/bills — A/P list view (PDR §3.21).
// Toolbar: Record bill · Pay bills · Draft bills · Request owner contribution.
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { RecordBillModal } from "@/components/pm/RecordBillModal";
import { PayBillsModal } from "@/components/pm/PayBillsModal";
import { RequestOwnerContributionModal } from "@/components/pm/RequestOwnerContributionModal";
import { formatDateOnly } from "@/lib/utils/dateInput";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";

interface BillRow {
  id: string;
  vendorId: string | null;
  invoiceDate: string;
  status: string;
  refNo: string;
  memo: string;
  amount: number;
  scopeName: string;
  workOrderId: string | null;
  journalEntryId: string | null;
  createdBy: string;
}

interface VendorOption {
  id: string;
  displayName: string;
}

type StatusFilter = "open" | "drafts" | "paid" | "voided" | "unreflected" | "all";

// Why a bill is missing from Financials — keyed by the reconciliation API's
// reason codes (see lib/pm/billReflection.ts). Shown as the badge tooltip.
const REASON_LABEL: Record<string, string> = {
  UNPOSTED: "Draft — not posted to the ledger, so it doesn't reach Financials",
  JE_MISSING: "Its journal entry is missing or not posted",
  NON_PL_ACCOUNT: "Posted to a non-income/expense account (e.g. an asset)",
  OUTSIDE_DATE_RANGE: "Dated outside the selected Financials period",
};

// Chip labels, reused by the search result-count line so it can name the
// subset being searched ("3 matching bills in Open").
const FILTER_LABEL: Record<StatusFilter, string> = {
  open: "Open",
  drafts: "Drafts",
  paid: "Paid",
  voided: "Voided",
  unreflected: "Not in Financials",
  all: "All",
};

export default function BillsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<BillRow[]>([]);
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<StatusFilter>("open");
  const [query, setQuery] = React.useState("");
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [ocrOpen, setOcrOpen] = React.useState(false);
  // billId → reason for bills that don't show in Financials.
  const [unreflected, setUnreflected] = React.useState<Map<string, string>>(
    new Map(),
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // includeVoided: a voided bill is still a record people need to find —
//        to confirm it was voided, or to read what it said before re-entering
//        it. The list is filtered client-side, so the "Voided" chip can hide
//        them from the default view without a second round-trip.
      const r = await fetch("/api/pm/bills?includeVoided=1");
      if (r.ok) setRows((await r.json()) as BillRow[]);
      else setError(`Error ${r.status}`);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
    // Reflection badges load independently so the list never waits on the
    // heavier reconciliation query. No date window → flags only structural
    // exclusions (drafts, missing JEs, non-P&L accounts), i.e. bills absent
    // from Financials regardless of the period being viewed.
    try {
      const reconRes = await fetch("/api/pm/financials/reconciliation");
      if (reconRes.ok) {
        const recon = (await reconRes.json()) as {
          unreflected: { billId: string; reason: string }[];
        };
        setUnreflected(
          new Map(recon.unreflected.map((u) => [u.billId, u.reason])),
        );
      }
    } catch {
      /* badges are best-effort */
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok) setVendors((await r.json()) as VendorOption[]);
    });
  }, []);

  const vendorById = React.useMemo(
    () => Object.fromEntries(vendors.map((v) => [v.id, v.displayName] as const)),
    [vendors],
  );

  const visible = React.useMemo(() => {
    // Status chip first, then the free-text query narrows whatever it selected.
    let out: BillRow[];
    if (filter === "open") {
      out = rows.filter(
        (r) => r.status === "Due" || r.status === "Overdue" || r.status === "Partially paid",
      );
    } else if (filter === "drafts") {
      out = rows.filter((r) => r.status === "Draft");
    } else if (filter === "paid") {
      out = rows.filter((r) => r.status === "Paid");
    } else if (filter === "voided") {
      out = rows.filter((r) => r.status === "Voided");
    } else if (filter === "unreflected") {
      out = rows.filter((r) => unreflected.has(r.id));
    } else {
      out = rows;
    }

    const q = query.trim().toLowerCase();
    if (!q) return out;
    // Search every column a person might remember the bill by: what it was
    // for (memo), where it posted (property/company), the vendor, the ref, and
    // the amount as typed — "32,767.23", "32767.23" and "32767" all match.
    return out.filter((r) => {
      const vendor = r.vendorId ? vendorById[r.vendorId] ?? "" : "";
      const amount = (r.amount / 100).toFixed(2);
      return [
        r.memo,
        r.scopeName,
        r.refNo,
        vendor,
        r.status,
        amount,
        amount.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, filter, unreflected, query, vendorById]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bills</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setRecordOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Record bill
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPayOpen(true)}>
              Pay bills
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFilter("drafts")}
            >
              <FileText className="h-3.5 w-3.5" /> Draft bills
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOcrOpen(true)}
            >
              Request owner contribution
            </Button>
            <Link
              href="/properties/accounting/bills/owner-contributions"
              className="inline-flex items-center text-xs font-bold uppercase tracking-widest text-blue-600 hover:underline"
            >
              Owner contributions →
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {error} — could not load bills.{" "}
              <button
                type="button"
                onClick={() => load()}
                className="font-bold underline"
              >
                Retry
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <FilterChip
              label="Open"
              count={rows.filter((r) =>
                ["Due", "Overdue", "Partially paid"].includes(r.status),
              ).length}
              selected={filter === "open"}
              onClick={() => setFilter("open")}
            />
            <FilterChip
              label="Drafts"
              count={rows.filter((r) => r.status === "Draft").length}
              selected={filter === "drafts"}
              onClick={() => setFilter("drafts")}
            />
            <FilterChip
              label="Paid"
              count={rows.filter((r) => r.status === "Paid").length}
              selected={filter === "paid"}
              onClick={() => setFilter("paid")}
            />
            <FilterChip
              label="Voided"
              count={rows.filter((r) => r.status === "Voided").length}
              selected={filter === "voided"}
              onClick={() => setFilter("voided")}
            />
            <FilterChip
              label="Not in Financials"
              count={rows.filter((r) => unreflected.has(r.id)).length}
              selected={filter === "unreflected"}
              onClick={() => setFilter("unreflected")}
            />
            <FilterChip
              label="All"
              count={rows.length}
              selected={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memo, property, vendor, amount…"
                aria-label="Search bills"
                className="w-72 rounded-full border border-border bg-surface py-1 pl-8 pr-3 text-xs text-fg placeholder:text-fg-muted focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          {query.trim() && (
            <p className="text-xs text-fg-muted">
              {visible.length} matching {visible.length === 1 ? "bill" : "bills"}{" "}
              in <span className="font-bold">{FILTER_LABEL[filter]}</span>.
              {visible.length === 0 && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className="font-bold underline"
                  >
                    Search all bills
                  </button>{" "}
                  instead.
                </>
              )}
            </p>
          )}

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Vendor</th>
                {/* A recurring tax bill has no vendor and an empty ref — the
                    memo and the property are the only things identifying it.
                    Without these two columns such a row rendered as "— — date"
                    and could not be picked out of the list at all. */}
                <th>Memo</th>
                <th>Property / company</th>
                <th>Ref #</th>
                <th>Invoice date</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-fg-muted">
                    No bills match this filter.{" "}
                    {filter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setFilter("all")}
                        className="font-bold underline"
                      >
                        Show all bills
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {visible.map((b) => (
                <tr key={b.id} className="border-b border-border/40">
                  <td className="py-2 text-fg">
                    <Link
                      href={`/properties/accounting/bills/${b.id}`}
                      className="font-medium hover:underline"
                    >
                      {b.vendorId
                        ? vendorById[b.vendorId] ?? "Linked vendor"
                        : "—"}
                    </Link>
                  </td>
                  <td className="max-w-[20rem] text-fg-muted">
                    {b.memo ? (
                      <span className="block truncate" title={b.memo}>
                        {b.memo}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-fg-muted">{b.scopeName || "—"}</td>
                  <td className="text-fg-muted">{b.refNo || "—"}</td>
                  <td className="text-fg-muted">
                    {formatDateOnly(b.invoiceDate)}
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <BillStatusChip status={b.status} />
                      {unreflected.has(b.id) && (
                        <span
                          title={
                            REASON_LABEL[unreflected.get(b.id) ?? ""] ??
                            "Not reflected in Financials"
                          }
                          className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning"
                        >
                          Not in Financials
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="tabular-nums font-bold text-fg">
                    <CurrencyAmount cents={b.amount} />
                  </td>
                  <td className="text-xs text-fg-muted">{b.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <RecordBillModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        onSaved={load}
      />
      <PayBillsModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onSaved={load}
      />
      <RequestOwnerContributionModal
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onSaved={async () => {
          setOcrOpen(false);
          toast({ title: "Contribution request created", variant: "success" });
        }}
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors " +
        (selected
          ? "border-primary bg-primary text-primary-fg"
          : "border-border bg-surface text-fg-muted hover:text-fg")
      }
    >
      {label}
      <span
        className={
          "rounded-full px-1.5 text-[10px] " +
          (selected
            ? "bg-primary-fg/20 text-primary-fg"
            : "bg-surface-high text-fg-muted")
        }
      >
        {count}
      </span>
    </button>
  );
}

function BillStatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    Draft: "bg-surface-high text-fg-muted",
    Due: "bg-warning/10 text-warning",
    Overdue: "bg-error/10 text-error",
    "Partially paid": "bg-info/10 text-info",
    Paid: "bg-success/10 text-success",
    Voided: "bg-surface-high text-fg-muted line-through",
  };
  const cls = map[status] ?? "bg-surface-high text-fg-muted";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {status}
    </span>
  );
}
