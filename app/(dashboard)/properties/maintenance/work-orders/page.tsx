// /properties/maintenance/work-orders — list view (PDR §3.10).
// Columns: subject, vendor, status pill, priority, due date (red if past-due),
// billStatus, billTotal.
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { AddWorkOrderModal } from "@/components/pm/AddWorkOrderModal";
import { formatDateOnly } from "@/lib/utils/dateInput";

interface WoRow {
  id: string;
  subject: string;
  vendorId: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  pastDue: boolean;
  taskId: string;
  billTotal: number;
  billStatus: string;
  propertyId: string | null;
  unitId: string | null;
  updatedAt: string;
}

interface VendorOption {
  id: string;
  displayName: string;
}

type StatusFilter = "open" | "terminal" | "all";

export default function WorkOrdersPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<WoRow[]>([]);
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<StatusFilter>("open");
  const [search, setSearch] = React.useState("");
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    // Always fetch the full set (including terminal) so the chips can derive
    // their counts and the table its rows from one in-memory dataset. Filtering
    // happens client-side in `visible` below.
    params.set("includeTerminal", "1");
    if (search.trim()) params.set("q", search.trim());
    const r = await fetch(`/api/pm/work-orders?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as WoRow[]);
    setLoading(false);
  }, [search]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok) setVendors((await r.json()) as VendorOption[]);
    });
  }, []);

  const isTerminal = (status: string) =>
    status === "Completed" || status === "Cancelled";

  const visible = React.useMemo(() => {
    if (filter === "terminal") return rows.filter((r) => isTerminal(r.status));
    if (filter === "open") return rows.filter((r) => !isTerminal(r.status));
    return rows;
  }, [rows, filter]);

  const vendorById = React.useMemo(
    () => Object.fromEntries(vendors.map((v) => [v.id, v.displayName] as const)),
    [vendors],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Work orders</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add work order
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <FilterChip
              label="Open"
              count={rows.filter((r) => !isTerminal(r.status)).length}
              selected={filter === "open"}
              onClick={() => setFilter("open")}
            />
            <FilterChip
              label="Completed / cancelled"
              count={rows.filter((r) => isTerminal(r.status)).length}
              selected={filter === "terminal"}
              onClick={() => setFilter("terminal")}
            />
            <FilterChip
              label="All"
              count={rows.length}
              selected={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <div className="ml-auto w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by subject"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Subject</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Due</th>
                <th>Bill status</th>
                <th>Total</th>
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
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-fg-muted">
                    No work orders match.
                  </td>
                </tr>
              )}
              {visible.map((w) => (
                <tr key={w.id} className="border-b border-border/40">
                  <td className="py-2 text-fg">
                    <Link
                      href={`/properties/maintenance/work-orders/${w.id}`}
                      className="font-medium hover:underline"
                    >
                      {w.subject}
                    </Link>
                  </td>
                  <td className="text-fg-muted">
                    {w.vendorId && vendorById[w.vendorId]
                      ? vendorById[w.vendorId]
                      : <span className="text-amber-600 font-medium">Unassigned</span>}
                  </td>
                  <td>
                    <StatusPill status={w.status} />
                  </td>
                  <td>
                    <PriorityChip priority={w.priority} />
                  </td>
                  <td className={w.pastDue ? "text-error font-bold" : "text-fg-muted"}>
                    {w.dueDate ? formatDateOnly(w.dueDate) : "—"}
                  </td>
                  <td className="text-fg-muted">{w.billStatus}</td>
                  <td className="tabular-nums text-fg">
                    ${(w.billTotal / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AddWorkOrderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          await load();
          toast({ title: "Work order created", variant: "success" });
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

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    New: "bg-info/10 text-info",
    "In progress": "bg-primary/10 text-primary",
    "On hold": "bg-warning/10 text-warning",
    Completed: "bg-success/10 text-success",
    Cancelled: "bg-surface-high text-fg-muted",
  };
  const cls = map[status] ?? "bg-surface-high text-fg-muted";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {status}
    </span>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    Low: "bg-surface-high text-fg-muted",
    Normal: "bg-info/10 text-info",
    High: "bg-warning/10 text-warning",
    Urgent: "bg-error/10 text-error",
  };
  const cls = map[priority] ?? "bg-surface-high text-fg-muted";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {priority}
    </span>
  );
}
