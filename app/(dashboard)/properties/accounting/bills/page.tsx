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

interface BillRow {
  id: string;
  vendorId: string | null;
  dueDate: string;
  status: string;
  refNo: string;
  amount: number;
  workOrderId: string | null;
  createdBy: string;
}

interface VendorOption {
  id: string;
  displayName: string;
}

type StatusFilter = "open" | "drafts" | "paid" | "all";

export default function BillsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<BillRow[]>([]);
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<StatusFilter>("open");
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/bills");
    if (r.ok) setRows((await r.json()) as BillRow[]);
    setLoading(false);
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
    return rows;
  }, [rows, filter]);

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
              onClick={() =>
                toast({
                  title: "Owner contribution request",
                  description:
                    "OwnerContributionRequest full surface ships with Phase 9 (BR-AC-19).",
                  variant: "success",
                })
              }
            >
              Request owner contribution
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
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
                <th>Due date</th>
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
                    {new Date(b.dueDate).toLocaleDateString()}
                  </td>
                  <td>
                    <BillStatusChip status={b.status} />
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
