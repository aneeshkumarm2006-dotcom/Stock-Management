// /properties/accounting/bills/owner-contributions — Owner
// contribution requests list (PDR §3.25, BR-AC-19). One row per
// OwnerContributionRequest with status badge, requested vs received
// totals, and inline "Record payment" / "Resend email" actions.
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { RequestOwnerContributionModal } from "@/components/pm/RequestOwnerContributionModal";
import type { OwnerContributionStatus } from "@/types/pm";
import { WarningInline } from "@/components/pm/WarningBadge";
import { getWarningMessage } from "@/lib/pm/warnings";

interface OcrRow {
  id: string;
  status: OwnerContributionStatus;
  dueDate: string;
  propertiesScope: string;
  taskDescription: string;
  requestedFromOwnerId: string;
  priority: string;
  requestedAmount: number;
  receivedAmount: number;
  taskId: string | null;
  createdAt: string;
}

interface OwnerOption {
  id: string;
  displayName: string;
}

interface BankAccountOption {
  id: string;
  name: string;
}

type StatusFilter = "active" | "New" | "In progress" | "Completed" | "all";

export default function OwnerContributionsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<OcrRow[]>([]);
  const [owners, setOwners] = React.useState<OwnerOption[]>([]);
  const [banks, setBanks] = React.useState<BankAccountOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<StatusFilter>("active");
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [payTarget, setPayTarget] = React.useState<OcrRow | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/owner-contribution-requests");
    if (r.ok) setRows((await r.json()) as OcrRow[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    fetch("/api/pm/rental-owners").then(async (r) => {
      if (r.ok) setOwners((await r.json()) as OwnerOption[]);
    });
    fetch("/api/pm/bank-accounts").then(async (r) => {
      if (r.ok) setBanks((await r.json()) as BankAccountOption[]);
    });
  }, []);

  const ownerNameById = React.useMemo(
    () => Object.fromEntries(owners.map((o) => [o.id, o.displayName] as const)),
    [owners],
  );

  const visible = React.useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "active") {
      return rows.filter((r) => r.status !== "Completed");
    }
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  async function resendEmail(row: OcrRow) {
    const r = await fetch(
      `/api/pm/owner-contribution-requests/${row.id}/notify`,
      { method: "POST" },
    );
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to send email",
        variant: "error",
      });
      return;
    }
    toast({ title: "Email sent", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <Link
        href="/properties/accounting/bills"
        className="inline-flex items-center gap-1 text-sm text-fg-muted hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to bills
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Owner contributions</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => setRequestOpen(true)}>
              Request owner contribution
            </Button>
            {(
              [
                ["active", "Active"],
                ["New", "New"],
                ["In progress", "In progress"],
                ["Completed", "Completed"],
                ["all", "All"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-bold " +
                  (filter === key
                    ? "border-primary bg-primary text-primary-fg"
                    : "border-border text-fg-muted hover:text-fg")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No contribution requests in this view.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-2">Owner</th>
                  <th>Properties</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th className="text-right">Requested</th>
                  <th className="text-right">Received</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-2">
                      {ownerNameById[r.requestedFromOwnerId] ?? "—"}
                    </td>
                    <td className="text-fg-muted">{r.propertiesScope}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="text-fg-muted">
                      {new Date(r.dueDate).toISOString().slice(0, 10)}
                    </td>
                    <td className="text-right tabular-nums">
                      <CurrencyAmount cents={r.requestedAmount} />
                    </td>
                    <td className="text-right tabular-nums">
                      <CurrencyAmount cents={r.receivedAmount} />
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => resendEmail(r)}
                          className="text-xs text-blue-600 hover:underline"
                          title="Resend email"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </button>
                        {r.status !== "Completed" && (
                          <button
                            onClick={() => setPayTarget(r)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Record payment
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <RequestOwnerContributionModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        onSaved={async () => {
          setRequestOpen(false);
          toast({ title: "Contribution request created", variant: "success" });
          await load();
        }}
      />

      {payTarget && (
        <RecordPaymentDialog
          row={payTarget}
          banks={banks}
          onClose={() => setPayTarget(null)}
          onSaved={async () => {
            setPayTarget(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    New: "bg-info/10 text-info",
    "In progress": "bg-warning/10 text-warning",
    Completed: "bg-success/10 text-success",
  };
  const cls = map[status] ?? "bg-surface-high text-fg-muted";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {status}
    </span>
  );
}

interface RecordPaymentDialogProps {
  row: OcrRow;
  banks: BankAccountOption[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function RecordPaymentDialog({
  row,
  banks,
  onClose,
  onSaved,
}: RecordPaymentDialogProps) {
  const { toast } = useToast();
  const remaining = (row.requestedAmount - row.receivedAmount) / 100;
  const [amount, setAmount] = React.useState(String(remaining.toFixed(2)));
  const [bankAccountId, setBankAccountId] = React.useState(banks[0]?.id ?? "");
  const [date, setDate] = React.useState(
    new Date().toISOString().slice(0, 10),
  );
  const [saving, setSaving] = React.useState(false);

  async function save() {
    // record-payment requires a bank account on the server (it debits the
    // bank's CoA in the JE) — guard here so the user gets a clear message
    // instead of a 400 "Invalid id".
    if (!bankAccountId) {
      toast({
        title: "Select a bank account to record the payment.",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    const r = await fetch(
      `/api/pm/owner-contribution-requests/${row.id}/record-payment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          bankAccountId,
          date,
        }),
      },
    );
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to record payment",
        variant: "error",
      });
      return;
    }
    toast({ title: "Payment recorded", variant: "success" });
    await onSaved();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title="Record payment" onClose={onClose} />
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            {row.propertiesScope} · {row.taskDescription.slice(0, 60)}
            {row.taskDescription.length > 60 ? "…" : ""}
          </p>
          <div>
            <Label htmlFor="pay-amount">Amount (USD)</Label>
            <Input
              id="pay-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pay-bank">Bank account</Label>
            <select
              id="pay-bank"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
            >
              <option value="">Select…</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="pay-date">Date</Label>
            <Input
              id="pay-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <WarningInline
            warnings={
              bankAccountId
                ? []
                : [
                    {
                      code: "MISSING_BANK_ACCOUNT",
                      message: getWarningMessage("MISSING_BANK_ACCOUNT"),
                    },
                  ]
            }
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
