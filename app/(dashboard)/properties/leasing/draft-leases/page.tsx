// /properties/leasing/draft-leases — list filtered by executionStatus.
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DraftLeaseFormModal } from "@/components/pm/DraftLeaseFormModal";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import {
  DRAFT_LEASE_EXECUTION_STATUSES,
  type DraftLeaseExecutionStatus,
} from "@/types/pm";

interface DraftRow {
  id: string;
  draftId: number;
  executionStatus: DraftLeaseExecutionStatus;
  esignatureStatus: string;
  propertyId: string;
  unitId: string;
  leaseType: string;
  startDate: string | null;
  endDate: string | null;
  primaryRentAmount: number;
  securityDeposit: number;
  moveInChargesUnpaid: number;
  moveInChargesTotal: number;
  promotedToLeaseId: string | null;
  updatedAt: string;
}

export default function DraftLeasesPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<DraftRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] =
    React.useState<DraftLeaseExecutionStatus | "all">("all");
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("executionStatus", filter);
    const r = await fetch(`/api/pm/draft-leases?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as DraftRow[]);
    setLoading(false);
  }, [filter]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Draft leases</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New draft
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilter("all")}
              className={
                "rounded-full border px-3 py-1 text-xs font-bold " +
                (filter === "all"
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-surface text-fg-muted")
              }
            >
              All
            </button>
            {DRAFT_LEASE_EXECUTION_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-bold " +
                  (filter === s
                    ? "border-primary bg-primary text-primary-fg"
                    : "border-border bg-surface text-fg-muted")
                }
              >
                {s}
              </button>
            ))}
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Draft #</th>
                <th>Type / dates</th>
                <th>Rent</th>
                <th>Deposit</th>
                <th>Move-in</th>
                <th>eSig</th>
                <th>Execution</th>
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
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-fg-muted">
                    No draft leases match.
                  </td>
                </tr>
              )}
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-border/40">
                  <td className="py-2">
                    <Link
                      href={`/properties/leasing/draft-leases/${d.id}`}
                      className="font-medium hover:underline"
                    >
                      #{d.draftId}
                    </Link>
                  </td>
                  <td className="text-fg-muted">
                    {d.leaseType}
                    {d.startDate && (
                      <span className="ml-2">
                        {new Date(d.startDate).toLocaleDateString()}
                        {d.endDate
                          ? ` → ${new Date(d.endDate).toLocaleDateString()}`
                          : " → (At-will)"}
                      </span>
                    )}
                  </td>
                  <td>
                    <CurrencyAmount cents={d.primaryRentAmount} />
                  </td>
                  <td>
                    <CurrencyAmount cents={d.securityDeposit} />
                  </td>
                  <td className="text-fg-muted">
                    {d.moveInChargesUnpaid} / {d.moveInChargesTotal} unpaid
                  </td>
                  <td>
                    <Badge variant="muted">{d.esignatureStatus}</Badge>
                  </td>
                  <td>
                    <Badge
                      variant={
                        d.executionStatus === "Executed"
                          ? "gain"
                          : d.executionStatus === "Cancelled"
                            ? "loss"
                            : "muted"
                      }
                    >
                      {d.executionStatus}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-fg-muted">
            Match count: {rows.length} loaded.
          </p>
        </CardContent>
      </Card>

      <DraftLeaseFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={async (id) => {
          await load();
          router.push(`/properties/leasing/draft-leases/${id}`);
        }}
      />
    </div>
  );
}
