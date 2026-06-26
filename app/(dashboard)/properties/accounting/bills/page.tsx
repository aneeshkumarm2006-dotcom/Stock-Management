// /properties/accounting/bills — A/P list view (PDR §3.21).
// Toolbar: Record bill · Pay bills · Draft bills · Request owner contribution.
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { RecordBillModal } from "@/components/pm/RecordBillModal";
import { PayBillsModal } from "@/components/pm/PayBillsModal";
import { RequestOwnerContributionModal } from "@/components/pm/RequestOwnerContributionModal";
import { formatDateOnly } from "@/lib/utils/dateInput";

interface BillRow {
  id: string;
  vendorId: string | null;
  invoiceDate: string;
  status: string;
  refNo: string;
  amount: number;
  workOrderId: string | null;
  journalEntryId: string | null;
  createdBy: string;
}

interface VendorOption {
  id: string;
  displayName: string;
}

type StatusFilter = "open" | "drafts" | "paid" | "unreflected" | "all";

// Why a bill is missing from Financials — keyed by the reconciliation API's
// reason codes (see lib/pm/billReflection.ts). Shown as the badge tooltip.
const REASON_LABEL: Record<string, string> = {
  UNPOSTED: "Draft — not posted to the ledger, so it doesn't reach Financials",
  JE_MISSING: "Its journal entry is missing or not posted",
  NON_PL_ACCOUNT: "Posted to a non-income/expense account (e.g. an asset)",
  OUTSIDE_DATE_RANGE: "Dated outside the selected Financials period",
};

export default function BillsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<BillRow[]>([]);
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<StatusFilter>("open");
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
      const r = await fetch("/api/pm/bills");
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
    if (filter === "open") {
      return rows.filter(
        (r) => r.status === "Due" || r.status === "Overdue" || r.status === "Partially paid",
      );
    }
    if (filter === "drafts") return rows.filter((r) => r.status === "Draft");
    if (filter === "paid") return rows.filter((r) => r.status === "Paid");
    if (filter === "unreflected")
      return rows.filter((r) => unreflected.has(r.id));
    return rows;
  }, [rows, filter, unreflected]);

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
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Vendor</th>
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
                  <td colSpan={6} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    No bills match.
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
                    ${(b.amount / 100).toFixed(2)}
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
