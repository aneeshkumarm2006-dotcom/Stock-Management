// /properties/accounting/chart-of-accounts — GL account ledger.
// System-seeded baseline is provisioned on first load (BR-AC-4).
"use client";

import * as React from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
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
import { EditEntityButton } from "@/components/pm/EditEntityButton";
import type {
  ChartOfAccountDefaultFor,
  ChartOfAccountType,
  CashFlowClassification,
} from "@/types/pm";

const TYPES: ChartOfAccountType[] = [
  "Current Asset",
  "Current Asset (cash)",
  "Fixed Asset",
  "Current Liability",
  "Long-term Liability",
  "Equity",
  "Income",
  "Operating Expense",
];

const DEFAULT_FOR: ChartOfAccountDefaultFor[] = [
  "Accounts Payable",
  "Accounts Receivable",
  "Application Fee Income",
  "Bank Fees",
  "Convenience Fee",
  "Last Month's Rent",
  "Late Fee Income",
  "Management Fee Income",
  "Operating Cash",
  "Security Deposit Liability",
  "Undeposited Funds",
];

const CASH_FLOW: CashFlowClassification[] = [
  "Operating activities",
  "Investing activities",
  "Financing activities",
  "N/A",
];

interface Row {
  id: string;
  name: string;
  type: ChartOfAccountType;
  defaultFor: ChartOfAccountDefaultFor | null;
  cashFlowClassification: CashFlowClassification;
  accountNumber: string;
  notes: string;
  systemSeeded: boolean;
  active: boolean;
}

export default function ChartOfAccountsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | undefined>();
  const [showInactive, setShowInactive] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(
      `/api/pm/chart-of-accounts${showInactive ? "?includeInactive=1" : ""}`,
    );
    if (r.ok) setRows((await r.json()) as Row[]);
    setLoading(false);
  }, [showInactive]);

  React.useEffect(() => {
    load();
  }, [load]);

  const grouped = React.useMemo(() => {
    const m = new Map<ChartOfAccountType, Row[]>();
    for (const r of rows) {
      const k = r.type;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return Array.from(m.entries());
  }, [rows]);

  async function archive(r: Row) {
    if (r.systemSeeded) return;
    const res = await fetch(`/api/pm/chart-of-accounts/${r.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Cannot archive", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Chart of accounts</CardTitle>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive
            </label>
            <Button
              size="sm"
              onClick={() => {
                setEditingId(undefined);
                setModalOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add account
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading && <p className="text-sm text-fg-muted">Loading…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-fg-muted">No accounts yet.</p>
          )}
          {grouped.map(([type, rs]) => (
            <div key={type} className="space-y-2">
              <h4 className="font-display text-xs font-bold uppercase tracking-widest text-fg-muted">
                {type}
              </h4>
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                  <tr>
                    <th className="w-1/2 py-2">Name</th>
                    <th>Default for</th>
                    <th>Account #</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => (
                    <tr
                      key={r.id}
                      className={
                        "border-b border-border/40 " +
                        (r.active ? "" : "opacity-50")
                      }
                    >
                      <td className="py-2 text-fg">
                        <span className="flex items-center gap-2">
                          {r.name}
                          {r.systemSeeded && (
                            <Lock
                              className="h-3 w-3 text-fg-muted"
                              aria-label="System-seeded"
                            />
                          )}
                        </span>
                      </td>
                      <td className="text-fg-muted">{r.defaultFor ?? "—"}</td>
                      <td className="text-fg-muted">{r.accountNumber || "—"}</td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <EditEntityButton
                            onClick={() => {
                              setEditingId(r.id);
                              setModalOpen(true);
                            }}
                            disabled={r.systemSeeded}
                          />
                          <button
                            type="button"
                            onClick={() => archive(r)}
                            disabled={r.systemSeeded || !r.active}
                            className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Archive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </CardContent>
      </Card>

      <AddAccountModal
        open={modalOpen}
        editingId={editingId}
        onClose={() => {
          setModalOpen(false);
          setEditingId(undefined);
        }}
        onSaved={load}
      />
    </div>
  );
}

function AddAccountModal({
  open,
  onClose,
  onSaved,
  editingId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  editingId?: string;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(editingId);
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<ChartOfAccountType>("Operating Expense");
  const [defaultFor, setDefaultFor] = React.useState<string>("");
  const [cashFlow, setCashFlow] = React.useState<CashFlowClassification>("N/A");
  const [accountNumber, setAccountNumber] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  function reset() {
    setName("");
    setType("Operating Expense");
    setDefaultFor("");
    setCashFlow("N/A");
    setAccountNumber("");
    setNotes("");
  }

  React.useEffect(() => {
    if (!open) return;
    if (!editingId) {
      reset();
      return;
    }
    let cancelled = false;
    fetch(`/api/pm/chart-of-accounts/${editingId}`).then(async (r) => {
      if (!r.ok || cancelled) return;
      const a = (await r.json()) as {
        name: string;
        type: ChartOfAccountType;
        defaultFor: string | null;
        cashFlowClassification: CashFlowClassification;
        accountNumber: string;
        notes: string;
      };
      if (cancelled) return;
      setName(a.name);
      setType(a.type);
      setDefaultFor(a.defaultFor ?? "");
      setCashFlow(a.cashFlowClassification);
      setAccountNumber(a.accountNumber ?? "");
      setNotes(a.notes ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [open, editingId]);

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "error" });
      return;
    }
    setSaving(true);
    const url = isEdit
      ? `/api/pm/chart-of-accounts/${editingId}`
      : "/api/pm/chart-of-accounts";
    const method = isEdit ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        type,
        defaultFor: defaultFor || null,
        cashFlowClassification: cashFlow,
        accountNumber: accountNumber.trim() || (isEdit ? "" : undefined),
        notes: notes.trim() || (isEdit ? "" : undefined),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({
      title: isEdit ? "Account updated" : "Account created",
      variant: "success",
    });
    reset();
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={isEdit ? "Edit account" : "Add account"}
          onClose={onClose}
        />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="coa-name">Name *</Label>
            <Input
              id="coa-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="coa-type">Type *</Label>
              <select
                id="coa-type"
                value={type}
                onChange={(e) => setType(e.target.value as ChartOfAccountType)}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="coa-cf">Cash flow</Label>
              <select
                id="coa-cf"
                value={cashFlow}
                onChange={(e) =>
                  setCashFlow(e.target.value as CashFlowClassification)
                }
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                {CASH_FLOW.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="coa-default">Default for</Label>
              <select
                id="coa-default"
                value={defaultFor}
                onChange={(e) => setDefaultFor(e.target.value)}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="">—</option>
                {DEFAULT_FOR.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="coa-num">Account number</Label>
              <Input
                id="coa-num"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="coa-notes">Notes</Label>
            <textarea
              id="coa-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px] w-full rounded border border-border bg-surface-highest px-3 py-2 text-sm text-fg"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
