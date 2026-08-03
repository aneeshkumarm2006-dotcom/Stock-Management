// Edit recurring check / bill / journal-entry modal.
//
// SCOPE. Each amount row carries its own `scopeType`/`scopeId`, matching the
// per-line scope model the GL uses everywhere else (reports attribute a
// property from `lines[].scopeId`, never the entry header — see
// app/api/pm/financials/matrix/route.ts). The grid therefore mirrors
// JournalEntryModal's paired Co./Prop. cell rather than inventing a
// rule-level scope field the schema does not have.
//
// A rule whose rows span several properties posts one Bill per property at
// run time (a Bill's `scope` is a single {type,id} and cannot represent two
// properties) — hence the inline hint under the grid.
//
// `unitId` and `refNo` are hydrated and re-submitted untouched but not
// rendered: nothing consumes them yet (postBillToLedger hardcodes
// `unitId: null`, and neither IBillLine nor IJournalLine has a refNo), so an
// input for them would be silently dropped at posting time. Round-tripping
// them means a rule set up via the API keeps them.
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
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
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
interface PropertyOption {
  id: string;
  name: string;
}

interface AmountRow {
  // Unique key for React; not sent to the API. Rows carry <select>s, so an
  // index key would hand a removed row's DOM state to its successor.
  key: string;
  scopeType: "Property" | "Company";
  scopeId: string;
  accountId: string;
  description: string;
  // Raw text input (dollars). Parsed/validated on submit via
  // parseCurrencyToDollars so "1,234.56" / "$1234.56" survive entry.
  amount: string;
  // Round-tripped, not edited here. See the file header.
  unitId: string | null;
  refNo: string | null;
}

function newAmountRow(): AmountRow {
  return {
    key: Math.random().toString(36).slice(2, 10),
    scopeType: "Company",
    scopeId: "",
    accountId: "",
    description: "",
    amount: "",
    unitId: null,
    refNo: null,
  };
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
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  // Bulk-apply helper above the grid. Client-only; never persisted.
  const [applyAllScopeId, setApplyAllScopeId] = React.useState("");

  const [type, setType] = React.useState<RecurringTransactionType>("Bill");
  const [payeeType, setPayeeType] =
    React.useState<RecurringPayeeType>("Vendor");
  const [payeeId, setPayeeId] = React.useState("");
  const [bankAccountId, setBankAccountId] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [frequency, setFrequency] =
    React.useState<RecurringFrequency>("Monthly");
  const [nextDate, setNextDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [postNDaysInAdvance, setPostNDaysInAdvance] = React.useState(5);
  const [duration, setDuration] =
    React.useState<RecurringDuration>("Until cancelled");
  const [occurrenceCount, setOccurrenceCount] = React.useState(12);
  const [queueForPrinting, setQueueForPrinting] = React.useState(false);
  const [active, setActive] = React.useState(true);
  const [amounts, setAmounts] = React.useState<AmountRow[]>(() => [
    newAmountRow(),
  ]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok && !cancelled) setVendors((await r.json()) as VendorOption[]);
    });
    fetch("/api/pm/rental-owners").then(async (r) => {
      if (r.ok && !cancelled) setOwners((await r.json()) as OwnerOption[]);
    });
    fetch("/api/pm/chart-of-accounts").then(async (r) => {
      if (r.ok && !cancelled) setAccounts((await r.json()) as AccountOption[]);
    });
    fetch("/api/pm/bank-accounts").then(async (r) => {
      if (r.ok && !cancelled) setBanks((await r.json()) as BankOption[]);
    });
    fetch("/api/pm/properties").then(async (r) => {
      if (!r.ok || cancelled) return;
      const rows = (await r.json()) as { id: string; propertyName: string }[];
      if (cancelled) return;
      setProperties(rows.map((p) => ({ id: p.id, name: p.propertyName })));
    });
    return () => {
      cancelled = true;
    };
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
          scopeType?: "Property" | "Company" | null;
          scopeId?: string | null;
          accountId: string;
          description: string;
          amount: number;
          unitId?: string | null;
          refNo?: string | null;
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
      setApplyAllScopeId("");
      setAmounts(
        d.amounts.map((a) => ({
          ...newAmountRow(),
          // Treat a row as Company unless it names a real property, so any
          // legacy shape (missing field, Property with a null id) is total.
          scopeType: a.scopeType === "Property" && a.scopeId ? "Property" : "Company",
          scopeId: a.scopeType === "Property" && a.scopeId ? a.scopeId : "",
          accountId: a.accountId,
          description: a.description,
          // server returns cents; show dollars as editable text
          amount: String(a.amount / 100),
          unitId: a.unitId ?? null,
          // GET returns '' rather than null for an unset refNo; normalise so
          // the submit path can send `undefined` (the validator types refNo as
          // an optional string, not a nullable one).
          refNo: a.refNo || null,
        })),
      );
    });
  }, [open, mode, recurringId]);

  // Live total of the grid, in dollars. Unparseable rows contribute 0 rather
  // than poisoning the sum with NaN.
  const amountsTotal = React.useMemo(
    () =>
      amounts.reduce((sum, a) => sum + (parseCurrencyToDollars(a.amount) ?? 0), 0),
    [amounts],
  );

  // Distinct scopes across rows that name an account — this is exactly how the
  // poster groups a rule into separate bills, so the hint below the grid can
  // never disagree with what actually posts.
  const scopeGroupCount = React.useMemo(
    () =>
      new Set(
        amounts
          .filter((a) => a.accountId)
          .map((a) =>
            a.scopeType === "Property" && a.scopeId ? a.scopeId : "company",
          ),
      ).size,
    [amounts],
  );

  function addRow() {
    setAmounts([...amounts, newAmountRow()]);
  }

  /** Bulk-set every row's scope from the picker above the grid. */
  function applyScopeToAllRows(propertyId: string) {
    setApplyAllScopeId(propertyId);
    setAmounts(
      amounts.map((a) => ({
        ...a,
        scopeType: propertyId ? ("Property" as const) : ("Company" as const),
        scopeId: propertyId,
      })),
    );
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
    if (!amounts.some((a) => a.accountId)) {
      toast({
        title: "Add at least one line with an account",
        variant: "error",
      });
      return;
    }
    // Parse each currency input; reject non-numeric rather than coercing to NaN.
    // Iterate over `amounts` (not a filtered copy) so the reported line number
    // matches the row the user is looking at.
    const parsedAmounts: Array<{
      scopeType: "Property" | "Company";
      scopeId: string | null;
      accountId: string;
      description: string | undefined;
      amount: number;
      unitId: string | null;
      refNo: string | undefined;
    }> = [];
    for (let i = 0; i < amounts.length; i++) {
      const a = amounts[i]!;
      if (!a.accountId) continue;
      const dollars = parseCurrencyToDollars(a.amount);
      if (dollars === null) {
        toast({
          title: `Line ${i + 1}: enter a valid amount`,
          variant: "error",
        });
        return;
      }
      if (a.scopeType === "Property" && !a.scopeId) {
        toast({
          title: `Line ${i + 1}: choose a property for property-scoped lines`,
          variant: "error",
        });
        return;
      }
      parsedAmounts.push({
        scopeType: a.scopeType,
        // Must be null, never "" — the validator's scopeId is a 24-hex regex.
        scopeId: a.scopeType === "Property" ? a.scopeId : null,
        accountId: a.accountId,
        description: a.description.trim() || undefined,
        amount: dollars, // dollars; server toCents() converts
        unitId: a.scopeType === "Property" ? a.unitId : null,
        refNo: a.refNo ?? undefined,
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
      occurrenceCount: duration === "End after N" ? occurrenceCount : null,
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
      title:
        mode === "create" ? "Recurring rule created" : "Recurring rule updated",
      variant: "success",
    });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader
          title={
            mode === "create" ? "New recurring rule" : "Edit recurring rule"
          }
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
            <div className="flex flex-wrap items-center gap-2">
              <Label
                htmlFor="rt-apply-all"
                className="text-xs uppercase tracking-widest text-fg-muted"
              >
                Apply to all rows
              </Label>
              <select
                id="rt-apply-all"
                className="rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
                value={applyAllScopeId}
                onChange={(e) => applyScopeToAllRows(e.target.value)}
              >
                <option value="">Company</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                  <tr>
                    <th className="px-2 py-1">Property or company</th>
                    <th className="px-2">Account</th>
                    <th className="px-2">Description</th>
                    <th className="px-2 text-right">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {amounts.map((a, i) => (
                    <tr key={a.key} className="border-b border-border/40">
                      <td className="w-56 px-2 py-1">
                        <div className="flex gap-1">
                          <select
                            aria-label={`Line ${i + 1} scope`}
                            className="rounded border border-border bg-surface px-1 py-1 text-xs text-fg"
                            value={a.scopeType}
                            onChange={(e) => {
                              const next = e.target.value as
                                | "Property"
                                | "Company";
                              setAmounts(
                                amounts.map((row, idx) =>
                                  idx === i
                                    ? {
                                        ...row,
                                        scopeType: next,
                                        // Drop the property and its unit when
                                        // switching back to Company so a stale
                                        // id can never be submitted.
                                        scopeId:
                                          next === "Property" ? row.scopeId : "",
                                        unitId:
                                          next === "Property" ? row.unitId : null,
                                      }
                                    : row,
                                ),
                              );
                            }}
                          >
                            <option value="Company">Co.</option>
                            <option value="Property">Prop.</option>
                          </select>
                          <select
                            aria-label={`Line ${i + 1} property`}
                            className="min-w-0 flex-1 rounded border border-border bg-surface px-1 py-1 text-xs text-fg disabled:opacity-50"
                            value={a.scopeId}
                            disabled={a.scopeType !== "Property"}
                            onChange={(e) =>
                              updateRow(i, "scopeId", e.target.value)
                            }
                          >
                            <option value="">—</option>
                            {properties.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="w-56 px-2 py-1">
                        <select
                          aria-label={`Line ${i + 1} account`}
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
                      <td className="px-2 py-1">
                        <Input
                          aria-label={`Line ${i + 1} description`}
                          value={a.description}
                          onChange={(e) =>
                            updateRow(i, "description", e.target.value)
                          }
                        />
                      </td>
                      <td className="w-28 px-2 py-1">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label={`Line ${i + 1} amount`}
                          value={a.amount}
                          onChange={(e) =>
                            updateRow(i, "amount", e.target.value)
                          }
                        />
                      </td>
                      <td className="w-8 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          aria-label={`Remove line ${i + 1}`}
                          className="text-fg-muted hover:text-error"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-surface">
                    <td
                      colSpan={3}
                      className="px-2 py-2 text-right text-xs font-bold uppercase tracking-widest text-fg-muted"
                    >
                      Total
                    </td>
                    <td className="px-2 py-2 text-right">
                      {/* convert={false}: this is the sum of the boxes above,
                          which are typed and stored in the rule's own
                          currency. Letting the USD/CAD display toggle rescale
                          it would show a total that disagrees with its own
                          rows — and with what actually posts. */}
                      <CurrencyAmount value={amountsTotal} convert={false} />
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {scopeGroupCount > 1 && type !== "Journal entry" && (
              <p className="text-xs text-fg-muted">
                This rule spans {scopeGroupCount} scopes — each posting
                generates {scopeGroupCount} separate {type.toLowerCase()}s, one
                per property.
              </p>
            )}
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
