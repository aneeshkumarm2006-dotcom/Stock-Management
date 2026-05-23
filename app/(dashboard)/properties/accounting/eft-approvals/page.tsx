// /properties/accounting/eft-approvals — Pending EFT queue (PDR §3.24).
// Per-row Approve / Reject actions. Single-approver flow per Phase 4
// [G-S-31] / [BR-AC-19].
"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

interface EftRow {
  id: string;
  date: string;
  bankAccountId: string;
  paidToName: string;
  payee: { type: string; id: string };
  status: string;
  amount: number;
  approverUserId: string | null;
  billId: string | null;
  propertiesScope: string;
  appliedRuleId: string | null;
  approvals: Array<{
    userId: string;
    decision: "Approved" | "Rejected";
    at: string;
  }>;
}

interface ApprovalRuleSummary {
  id: string;
  approverUserIds: string[];
  semantics: "any-of" | "all-of";
}

type Filter = "pending" | "approved" | "rejected" | "all";

export default function EftApprovalsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<EftRow[]>([]);
  const [rules, setRules] = React.useState<ApprovalRuleSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<Filter>("pending");

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/eft-requests");
    if (r.ok) setRows((await r.json()) as EftRow[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    fetch("/api/pm/approval-rules").then(async (r) => {
      if (r.ok) {
        const data = (await r.json()) as Array<{
          id: string;
          approverUserIds: string[];
          semantics: "any-of" | "all-of";
          active: boolean;
        }>;
        setRules(data.filter((x) => x.active));
      }
    });
  }, []);

  const ruleById = React.useMemo(
    () => Object.fromEntries(rules.map((r) => [r.id, r] as const)),
    [rules],
  );

  React.useEffect(() => {
    load();
  }, [load]);

  const visible = React.useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter(
      (r) => r.status.toLowerCase() === filter.toLowerCase(),
    );
  }, [rows, filter]);

  async function act(eftId: string, action: "approve" | "reject") {
    const res = await fetch(`/api/pm/eft-requests/${eftId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: `${action} failed`, description: err.error, variant: "error" });
      return;
    }
    toast({
      title: action === "approve" ? "EFT approved" : "EFT rejected",
      variant: "success",
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>EFT approvals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {(["pending", "approved", "rejected", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase transition-colors " +
                  (filter === f
                    ? "border-primary bg-primary text-primary-fg"
                    : "border-border bg-surface text-fg-muted hover:text-fg")
                }
              >
                {f}
              </button>
            ))}
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Date</th>
                <th>Paid to</th>
                <th>Payee type</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Chain</th>
                <th />
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
                    No EFT requests match.
                  </td>
                </tr>
              )}
              {visible.map((e) => {
                const rule = e.appliedRuleId ? ruleById[e.appliedRuleId] : null;
                const required = rule?.approverUserIds.length ?? 0;
                const approvedCount = e.approvals.filter(
                  (a) => a.decision === "Approved",
                ).length;
                return (
                  <tr key={e.id} className="border-b border-border/40">
                    <td className="py-2 text-fg-muted">
                      {new Date(e.date).toLocaleDateString()}
                    </td>
                    <td className="text-fg">{e.paidToName}</td>
                    <td className="text-fg-muted">{e.payee.type}</td>
                    <td className="tabular-nums font-bold text-fg">
                      ${(e.amount / 100).toFixed(2)}
                    </td>
                    <td>
                      <StatusChip status={e.status} />
                    </td>
                    <td className="text-xs text-fg-muted">
                      {rule
                        ? `${approvedCount} of ${required} ${rule.semantics}`
                        : e.approvals.length > 0
                          ? `${approvedCount} approval(s)`
                          : "Single approver"}
                    </td>
                    <td className="text-right">
                      {e.status === "Pending" && (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => act(e.id, "approve")}
                          >
                            <Check className="h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => act(e.id, "reject")}
                          >
                            <X className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    Pending: "bg-warning/10 text-warning",
    Approved: "bg-success/10 text-success",
    Rejected: "bg-error/10 text-error",
  };
  const cls = map[status] ?? "bg-surface-high text-fg-muted";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {status}
    </span>
  );
}
