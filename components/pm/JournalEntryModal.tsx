// Shared General Journal Entry modal. Used by:
//   - General Ledger page → "+ Add general journal entry"
//   - Future Phase 4 Bill posting flow
//   - Future floating "+" action surface
//
// The modal handles a balanced double-entry GL post via POST /api/pm/journal-entries.
// Client-side: instant balance preview as the user fills lines, with a green/red
// "balanced" / "imbalanced" indicator. The server still re-validates (BR-AC-1)
// so a network race or admin override still fails closed.
"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
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
import { ScopePicker, useCompanyAccounts } from "@/components/pm/ScopePicker";
import { scopeFromInput, toJournalLineScope } from "@/lib/pm/scope";

interface AccountOption {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

interface PropertyOption {
  id: string;
  name: string;
}

interface LineDraft {
  // Unique key for React; not sent to API.
  key: string;
  accountId: string;
  scopeType: "Property" | "Company";
  scopeId: string;
  description: string;
  debit: string; // raw input, parsed on submit
  credit: string;
}

function newLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2, 10),
    accountId: "",
    scopeType: "Company",
    scopeId: "",
    description: "",
    debit: "",
    credit: "",
  };
}

interface JournalEntryModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** Pre-fill the entry-level scope (e.g. opening from a Property page). */
  defaultScopeType?: "Property" | "Company";
  defaultScopeId?: string;
}

export function JournalEntryModal({
  open,
  onClose,
  onSaved,
  defaultScopeType = "Company",
  defaultScopeId = "",
}: JournalEntryModalProps) {
  const { toast } = useToast();
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [date, setDate] = React.useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [scopeType, setScopeType] = React.useState<"Property" | "Company">(
    defaultScopeType,
  );
  const [scopeId, setScopeId] = React.useState<string>(defaultScopeId);
  const [memo, setMemo] = React.useState<string>("");
  const [lines, setLines] = React.useState<LineDraft[]>(() => [
    newLine(),
    newLine(),
  ]);
  const [saving, setSaving] = React.useState(false);

  const companies = useCompanyAccounts(open);

  // Load reference data on open.
  React.useEffect(() => {
    if (!open) return;
    setDate(new Date().toISOString().slice(0, 10));
    setScopeType(defaultScopeType);
    setScopeId(defaultScopeId);
    setMemo("");
    setLines([newLine(), newLine()]);
    let cancelled = false;
    Promise.all([
      fetch("/api/pm/chart-of-accounts").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/pm/properties").then((r) => (r.ok ? r.json() : [])),
    ]).then(([a, p]) => {
      if (cancelled) return;
      setAccounts((a as AccountOption[]).filter((row) => row.active !== false));
      setProperties(
        (p as { id: string; propertyName: string }[]).map((row) => ({
          id: row.id,
          name: row.propertyName,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, defaultScopeType, defaultScopeId]);

  const totals = React.useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      const d = Number(l.debit || 0);
      const c = Number(l.credit || 0);
      if (Number.isFinite(d)) debit += d;
      if (Number.isFinite(c)) credit += c;
    }
    return {
      debit,
      credit,
      balanced:
        Math.round(debit * 100) === Math.round(credit * 100) && debit > 0,
    };
  }, [lines]);

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(idx: number) {
    setLines((prev) =>
      prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx),
    );
  }

  async function save() {
    if (!totals.balanced) {
      toast({
        title: "Unbalanced entry",
        description: "Debits must equal credits before posting.",
        variant: "error",
      });
      return;
    }
    if (scopeType === "Property" && !scopeId) {
      toast({ title: "Pick a property for the entry scope", variant: "error" });
      return;
    }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (!l.accountId) {
        toast({ title: `Line ${i + 1}: pick an account`, variant: "error" });
        return;
      }
      const d = Number(l.debit || 0);
      const c = Number(l.credit || 0);
      if (!Number.isFinite(d) || !Number.isFinite(c)) {
        toast({
          title: `Line ${i + 1}: amounts must be valid numbers`,
          variant: "error",
        });
        return;
      }
      if (d < 0 || c < 0) {
        toast({
          title: `Line ${i + 1}: amounts cannot be negative`,
          variant: "error",
        });
        return;
      }
      if (d + c <= 0) {
        toast({
          title: `Line ${i + 1}: enter a debit or a credit`,
          variant: "error",
        });
        return;
      }
      if (d > 0 && c > 0) {
        toast({
          title: `Line ${i + 1}: enter either a debit OR a credit`,
          variant: "error",
        });
        return;
      }
      if (l.scopeType === "Property" && !l.scopeId) {
        toast({
          title: `Line ${i + 1}: pick a property for property-scoped lines`,
          variant: "error",
        });
        return;
      }
    }

    setSaving(true);
    const body = {
      date,
      ...toJournalLineScope(scopeFromInput(scopeType, scopeId)),
      memo: memo.trim() || undefined,
      // The PER-LINE scope is the one that decides which Financials column this
      // entry lands in: both P&L aggregators unwind `lines` and group on
      // `lines.scopeId`, and never read the entry-level scope. An entry headed
      // "Ramco" whose lines are all unscoped shows up entirely under
      // "Company (unassigned)".
      lines: lines.map((l) => ({
        accountId: l.accountId,
        ...toJournalLineScope(scopeFromInput(l.scopeType, l.scopeId)),
        description: l.description.trim() || undefined,
        debit: Number.isFinite(Number(l.debit || 0)) ? Number(l.debit || 0) : 0,
        credit: Number.isFinite(Number(l.credit || 0))
          ? Number(l.credit || 0)
          : 0,
      })),
      status: "Posted",
    };
    const res = await fetch("/api/pm/journal-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: Record<string, string[]>;
      };
      const issueMsg = err.issues
        ? Object.values(err.issues).flat().join("; ")
        : (err.error ?? "Failed to post");
      toast({ title: "Post failed", description: issueMsg, variant: "error" });
      return;
    }
    toast({ title: "Journal entry posted", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader title="General journal entry" onClose={onClose} />
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="je-date">Date *</Label>
              <Input
                id="je-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="je-scope">Property or company *</Label>
              <ScopePicker
                id="je-scope"
                scopeType={scopeType}
                scopeId={scopeId}
                properties={properties}
                companies={companies}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
                onChange={(next) => {
                  setScopeType(next.scopeType);
                  setScopeId(next.scopeId);
                }}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="je-memo">Memo</Label>
            <Input
              id="je-memo"
              value={memo}
              maxLength={256}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional"
            />
            <p className="text-xs text-fg-muted">{memo.length}/256</p>
          </div>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="px-2 py-2">Account</th>
                  <th>Scope</th>
                  <th>Description</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={l.key} className="border-b border-border/30">
                    <td className="px-2 py-1">
                      <select
                        value={l.accountId}
                        onChange={(e) =>
                          updateLine(idx, { accountId: e.target.value })
                        }
                        className="h-9 w-full rounded border border-border bg-surface-highest px-2 text-sm text-fg"
                      >
                        <option value="">— account —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.type})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <ScopePicker
                        scopeType={l.scopeType}
                        scopeId={l.scopeId}
                        properties={properties}
                        companies={companies}
                        placeholder="—"
                        aria-label={`Line ${idx + 1} property or company`}
                        className="h-9 w-full min-w-0 rounded border border-border bg-surface-highest px-1 text-xs text-fg"
                        onChange={(next) =>
                          updateLine(idx, {
                            scopeType: next.scopeType,
                            scopeId: next.scopeId,
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={l.description}
                        onChange={(e) =>
                          updateLine(idx, { description: e.target.value })
                        }
                        className="h-9"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={l.debit}
                        onChange={(e) =>
                          updateLine(idx, { debit: e.target.value, credit: "" })
                        }
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-9 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={l.credit}
                        onChange={(e) =>
                          updateLine(idx, { credit: e.target.value, debit: "" })
                        }
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-9 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length <= 2}
                        className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface">
                  <td
                    colSpan={3}
                    className="px-2 py-2 text-right text-xs font-bold uppercase tracking-widest text-fg-muted"
                  >
                    Totals
                  </td>
                  <td className="px-2 py-2 text-right">
                    <CurrencyAmount value={totals.debit} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <CurrencyAmount value={totals.credit} />
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addLine}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
            <span
              className={
                "rounded px-2 py-0.5 text-xs font-bold uppercase " +
                (totals.balanced
                  ? "bg-success/15 text-success"
                  : "bg-warning/15 text-warning")
              }
            >
              {totals.balanced
                ? "Balanced"
                : `Imbalance ${(totals.debit - totals.credit).toFixed(2)}`}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !totals.balanced}>
            {saving ? "Posting…" : "Post entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default JournalEntryModal;
