// Edit recurring check / bill / journal-entry modal. Phase 4 ships the
// minimum viable editor; Phase 9's full RecurringTransaction surface adds
// preview of next N postings, distribution editor across multiple
// properties, etc.
"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
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
import { parseCurrencyToDollars } from "@/lib/pm/currency";
import {
  RECURRING_DURATIONS,
  RECURRING_FREQUENCIES,
  RECURRING_PAYEE_TYPES,
  RECURRING_TRANSACTION_TYPES,
  type RecurringDuration,
  type RecurringFrequency,
  type RecurringPayeeType,
  type RecurringTransactionType,
} from "@/types/pm";

interface VendorOption {
  id: string;
  displayName: string;
}
interface OwnerOption {
  id: string;
  displayName: string;
}
interface AccountOption {
  id: string;
  name: string;
}
interface BankOption {
  id: string;
  name: string;
}

interface AmountRow {
  accountId: string;
  description: string;
  // Raw text input (dollars). Parsed/validated on submit via
  // parseCurrencyToDollars so "1,234.56" / "$1234.56" survive entry.
  amount: string;
}

interface EditRecurringCheckModalProps {
  open: boolean;
  mode: "create" | "edit";
  recurringId?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function EditRecurringCheckModal({
  open,
  mode,
  recurringId,
  onClose,
  onSaved,
}: EditRecurringCheckModalProps) {
  const { toast } = useToast();
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [owners, setOwners] = React.useState<OwnerOption[]>([]);
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [banks, setBanks] = React.useState<BankOption[]>([]);

  const [type, setType] = React.useState<RecurringTransactionType>("Bill");
  const [payeeType, setPayeeType] = React.useState<RecurringPayeeType>("Vendor");
  const [payeeId, setPayeeId] = React.useState("");
  const [bankAccountId, setBankAccountId] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [frequency, setFrequency] = React.useState<RecurringFrequency>("Monthly");
  const [nextDate, setNextDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [postNDaysInAdvance, setPostNDaysInAdvance] = React.useState(5);
  const [duration, setDuration] = React.useState<RecurringDuration>(
    "Until cancelled",
  );
  const [occurrenceCount, setOccurrenceCount] = React.useState(12);
  const [queueForPrinting, setQueueForPrinting] = React.useState(false);
  const [active, setActive] = React.useState(true);
  const [amounts, setAmounts] = React.useState<AmountRow[]>([
    { accountId: "", description: "", amount: "" },
  ]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok) setVendors((await r.json()) as VendorOption[]);
    });
    fetch("/api/pm/rental-owners").then(async (r) => {
      if (r.ok) setOwners((await r.json()) as OwnerOption[]);
    });
    fetch("/api/pm/chart-of-accounts").then(async (r) => {
      if (r.ok) setAccounts((await r.json()) as AccountOption[]);
    });
    fetch("/api/pm/bank-accounts").then(async (r) => {
      if (r.ok) setBanks((await r.json()) as BankOption[]);
    });
  }, [open]);

  React.useEffect(() => {
    if (!open || mode !== "edit" || !recurringId) return;
    fetch(`/api/pm/recurring-transactions/${recurringId}`).then(async (r) => {
      if (!r.ok) return;
      const d = (await r.json()) as {
        type: RecurringTransactionType;
        payee: { type: RecurringPayeeType; id: string } | null;
        bankAccountId: string | null;
        memo: string;
        frequency: RecurringFrequency;
        nextDate: string;
        postNDaysInAdvance: number;
        duration: RecurringDuration;
        occurrenceCount: number | null;
        queueForPrinting: boolean;
        active: boolean;
        amounts: Array<{
          accountId: string;
          description: string;
          amount: number;
        }>;
      };
      setType(d.type);
      setPayeeType(d.payee?.type ?? "Vendor");
      setPayeeId(d.payee?.id ?? "");
      setBankAccountId(d.bankAccountId ?? "");
      setMemo(d.memo);
      setFrequency(d.frequency);
      setNextDate(new Date(d.nextDate).toISOString().slice(0, 10));
      setPostNDaysInAdvance(d.postNDaysInAdvance);
      setDuration(d.duration);
      setOccurrenceCount(d.occurrenceCount ?? 12);
      setQueueForPrinting(d.queueForPrinting);
      setActive(d.active);
      setAmounts(
        d.amounts.map((a) => ({
          accountId: a.accountId,
          description: a.description,
          // server returns cents; show dollars as editable text
          amount: String(a.amount / 100),
        })),
      );
    });
  }, [open, mode, recurringId]);

  function addRow() {
    setAmounts([...amounts, { accountId: "", description: "", amount: "" }]);
  }
  function removeRow(idx: number) {
    setAmounts(amounts.filter((_, i) => i !== idx));
  }
  function updateRow<K extends keyof AmountRow>(
    idx: number,
    key: K,
    value: AmountRow[K],
  ) {
    setAmounts(
      amounts.map((a, i) =>
        i === idx ? ({ ...a, [key]: value } as AmountRow) : a,
      ),
    );
  }

  async function deleteRule() {
    if (mode !== "edit" || !recurringId) return;
    if (
      !confirm(
        "Delete this recurring rule? Already-posted occurrences are kept; no new postings will fire.",
      )
    ) {
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/pm/recurring-transactions/${recurringId}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Delete failed",
        description: err.error,
        variant: "error",
      });
      return;
    }
    toast({ title: "Recurring rule deleted", variant: "success" });
    onClose();
    await onSaved();
  }

  async function save() {
    if (type !== "Journal entry" && !payeeId) {
      toast({ title: "Payee is required for Check / Bill", variant: "error" });
      return;
    }
    const accountRows = amounts.filter((a) => a.accountId);
    if (accountRows.length === 0) {
      toast({ title: "Add at least one line with an account", variant: "error" });
      return;
    }
    // Parse each currency input; reject non-numeric rather than coercing to NaN.
    const parsedAmounts: Array<{
      scopeType: string;
      accountId: string;
      description: string | undefined;
      amount: number;
    }> = [];
    for (let i = 0; i < accountRows.length; i++) {
      const a = accountRows[i]!;
      const dollars = parseCurrencyToDollars(a.amount);
      if (dollars === null) {
        toast({
          title: `Line ${i + 1}: enter a valid amount`,
          variant: "error",
        });
        return;
      }
      parsedAmounts.push({
        scopeType: "Company",
        accountId: a.accountId,
        description: a.description.trim() || undefined,
        amount: dollars, // dollars; server toCents() converts
      });
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      type,
      payee:
        type !== "Journal entry" && payeeId
          ? { type: payeeType, id: payeeId }
          : null,
      bankAccountId: bankAccountId || null,
      memo: memo.trim() || undefined,
      frequency,
      nextDate: new Date(nextDate).toISOString(),
      postNDaysInAdvance,
      duration,
      occurrenceCount:
        duration === "End after N" ? occurrenceCount : null,
      amounts: parsedAmounts,
      queueForPrinting,
      active,
    };
    const url =
      mode === "create"
        ? "/api/pm/recurring-transactions"
        : `/api/pm/recurring-transactions/${recurringId}`;
    const method = mode === "create" ? "POST" : "PATCH";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({
      title: mode === "create" ? "Recurring rule created" : "Recurring rule updated",
      variant: "success",
    });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader
          title={mode === "create" ? "New recurring rule" : "Edit recurring rule"}
          onClose={onClose}
        />
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="rt-type">Type *</Label>
              <select
                id="rt-type"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={type}
                onChange={(e) =>
                  setType(e.target.value as RecurringTransactionType)
                }
              >
                {RECURRING_TRANSACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-frequency">Frequency *</Label>
              <select
                id="rt-frequency"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={frequency}
                onChange={(e) =>
                  setFrequency(e.target.value as RecurringFrequency)
                }
              >
                {RECURRING_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-next">Next date *</Label>
              <Input
                id="rt-next"
                type="date"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
              />
            </div>
          </div>

          {type !== "Journal entry" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rt-payee-type">Payee type *</Label>
                <select
                  id="rt-payee-type"
                  className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                  value={payeeType}
                  onChange={(e) =>
                    setPayeeType(e.target.value as RecurringPayeeType)
                  }
                >
                  {RECURRING_PAYEE_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rt-payee">Payee *</Label>
                <select
                  id="rt-payee"
                  className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                  value={payeeId}
                  onChange={(e) => setPayeeId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {(payeeType === "Vendor" ? vendors : owners).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="rt-bank">Bank account</Label>
              <select
                id="rt-bank"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">Default trust account</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-lead">Post N days in advance</Label>
              <Input
                id="rt-lead"
                type="number"
                min={0}
                max={60}
                value={postNDaysInAdvance}
                onChange={(e) =>
                  setPostNDaysInAdvance(Number(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-duration">Duration</Label>
              <select
                id="rt-duration"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={duration}
                onChange={(e) =>
                  setDuration(e.target.value as RecurringDuration)
                }
              >
                {RECURRING_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {duration === "End after N" && (
            <div className="space-y-1 md:w-1/3">
              <Label htmlFor="rt-count">Occurrence count *</Label>
              <Input
                id="rt-count"
                type="number"
                min={1}
                value={occurrenceCount}
                onChange={(e) =>
                  setOccurrenceCount(Number(e.target.value) || 1)
                }
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="rt-memo">Memo (≤256 chars)</Label>
            <Input
              id="rt-memo"
              maxLength={256}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
            <span className="text-[10px] uppercase tracking-widest text-fg-muted">
              {memo.length}/256
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-widest text-fg-muted">
                Amounts
              </h4>
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" /> Add row
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-1">Account</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {amounts.map((a, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="w-56 py-1">
                      <select
                        className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
                        value={a.accountId}
                        onChange={(e) =>
                          updateRow(i, "accountId", e.target.value)
                        }
                      >
                        <option value="">Choose…</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Input
                        value={a.description}
                        onChange={(e) =>
                          updateRow(i, "description", e.target.value)
                        }
                      />
                    </td>
                    <td className="w-28">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={a.amount}
                        onChange={(e) =>
                          updateRow(i, "amount", e.target.value)
                        }
                      />
                    </td>
                    <td className="w-8 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-fg-muted hover:text-error"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-fg">
            {type === "Check" && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={queueForPrinting}
                  onChange={(e) => setQueueForPrinting(e.target.checked)}
                />
                Queue for printing
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          </div>
        </div>
        <DialogFooter>
          {mode === "edit" && (
            <Button
              variant="outline"
              onClick={deleteRule}
              disabled={saving}
              className="mr-auto border-error text-error hover:bg-error/10"
            >
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
