// Pay bills modal — multi-select unpaid Bills, choose bank + method,
// batch-post BillPayments via POST /api/pm/bill-payments. Each Bill posts
// its own JE so the audit trail stays atomic per Bill.
"use client";

import * as React from "react";
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
import { computeWarnings } from "@/lib/pm/warnings";
import { WarningInline } from "@/components/pm/WarningBadge";
import {
  BILL_PAYMENT_METHODS,
  type BillPaymentMethod,
} from "@/types/pm";

interface BillRow {
  id: string;
  vendorId: string | null;
  dueDate: string;
  status: string;
  refNo: string;
  amount: number;
}

interface BankOption {
  id: string;
  name: string;
}

interface VendorOption {
  id: string;
  displayName: string;
}

interface PayBillsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

interface SelectedRow {
  bill: BillRow;
  payAmount: number;
}

export function PayBillsModal({ open, onClose, onSaved }: PayBillsModalProps) {
  const { toast } = useToast();
  const [bills, setBills] = React.useState<BillRow[]>([]);
  const [banks, setBanks] = React.useState<BankOption[]>([]);
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [selected, setSelected] = React.useState<Record<string, SelectedRow>>({});
  const [bankAccountId, setBankAccountId] = React.useState("");
  const [method, setMethod] = React.useState<BillPaymentMethod>("ACH");
  const [checkNumber, setCheckNumber] = React.useState("");
  const [paidDate, setPaidDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [saving, setSaving] = React.useState(false);
  // Per-bill error markers from the last batch post, keyed by bill id (ADD-009).
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    fetch("/api/pm/bills?status=Due").then(async (r) => {
      if (r.ok) {
        const rows = (await r.json()) as BillRow[];
        // Also include Partially paid + Overdue.
        const more = await Promise.all([
          fetch("/api/pm/bills?status=Overdue").then((r2) =>
            r2.ok ? (r2.json() as Promise<BillRow[]>) : [],
          ),
          fetch("/api/pm/bills?status=Partially+paid").then((r2) =>
            r2.ok ? (r2.json() as Promise<BillRow[]>) : [],
          ),
        ]);
        setBills([...rows, ...more.flat()]);
      }
    });
    fetch("/api/pm/bank-accounts").then(async (r) => {
      if (r.ok) {
        const rows = (await r.json()) as BankOption[];
        setBanks(rows);
        const first = rows[0];
        if (first && !bankAccountId) setBankAccountId(first.id);
      }
    });
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok) setVendors((await r.json()) as VendorOption[]);
    });
    setSelected({});
    setRowErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const vendorById = React.useMemo(
    () => Object.fromEntries(vendors.map((v) => [v.id, v.displayName] as const)),
    [vendors],
  );

  function toggle(b: BillRow) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[b.id]) {
        delete next[b.id];
      } else {
        next[b.id] = { bill: b, payAmount: b.amount / 100 };
      }
      return next;
    });
  }

  const totalCents = Object.values(selected).reduce(
    (s, r) => s + Math.round(r.payAmount * 100),
    0,
  );

  function valid(): string | null {
    // Bank-account and check-number checks moved to non-blocking warnings.
    // Selecting at least one bill stays a hard requirement — paying nothing
    // is a no-op (warning.md: "intentionally left as blocking").
    if (Object.keys(selected).length === 0) return "Select at least one bill";
    return null;
  }

  async function save() {
    const err = valid();
    if (err) {
      toast({ title: err, variant: "error" });
      return;
    }
    setSaving(true);
    setRowErrors({});
    const failures: string[] = [];
    const nextErrors: Record<string, string> = {};
    const succeededIds: string[] = [];
    const attempted = Object.keys(selected).length;
    for (const row of Object.values(selected)) {
      const res = await fetch("/api/pm/bill-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billId: row.bill.id,
          bankAccountId,
          paymentMethod: method,
          checkNumber: method === "Check" ? checkNumber.trim() : undefined,
          amount: row.payAmount,
          paidDate: new Date(paidDate).toISOString(),
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = errBody.error ?? res.statusText;
        nextErrors[row.bill.id] = msg;
        failures.push(`${row.bill.id.slice(-6)} (${msg})`);
      } else {
        succeededIds.push(row.bill.id);
      }
    }
    setSaving(false);

    // Strip successfully-posted bills from the selection so a retry only
    // re-attempts the failures and never double-posts a paid bill (ADD-009).
    if (succeededIds.length > 0) {
      setSelected((prev) => {
        const next = { ...prev };
        for (const billId of succeededIds) delete next[billId];
        return next;
      });
    }
    setRowErrors(nextErrors);

    // Always refetch the parent so the table reflects current state, even on a
    // partial failure (some payments posted, some didn't) — ADD-009.
    await onSaved();

    if (failures.length === 0) {
      toast({
        title: `Posted ${attempted} payment(s)`,
        variant: "success",
      });
      onClose();
    } else {
      toast({
        title:
          succeededIds.length > 0
            ? `Posted ${succeededIds.length} of ${attempted}; ${failures.length} failed`
            : "Some payments failed",
        description: failures.join(", "),
        variant: "error",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader title="Pay bills" onClose={onClose} />
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="pay-bank">Bank account *</Label>
              <select
                id="pay-bank"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">Choose…</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-method">Method *</Label>
              <select
                id="pay-method"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as BillPaymentMethod)
                }
              >
                {BILL_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-date">Paid date *</Label>
              <Input
                id="pay-date"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </div>
          </div>
          {method === "Check" && (
            <div className="space-y-1 md:w-1/3">
              <Label htmlFor="pay-check">Check number *</Label>
              <Input
                id="pay-check"
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
              />
            </div>
          )}

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th />
                <th>Vendor</th>
                <th>Ref</th>
                <th>Due</th>
                <th>Amount</th>
                <th>Pay</th>
              </tr>
            </thead>
            <tbody>
              {bills.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    No payable bills found.
                  </td>
                </tr>
              )}
              {bills.map((b) => {
                const sel = selected[b.id];
                const rowError = rowErrors[b.id];
                return (
                  <tr
                    key={b.id}
                    className={
                      "border-b border-border/40 " +
                      (rowError ? "bg-error/5" : "")
                    }
                  >
                    <td className="py-1 w-8">
                      <input
                        type="checkbox"
                        checked={Boolean(sel)}
                        onChange={() => toggle(b)}
                      />
                    </td>
                    <td className="text-fg">
                      {b.vendorId ? vendorById[b.vendorId] ?? "—" : "—"}
                    </td>
                    <td className="text-fg-muted">{b.refNo || "—"}</td>
                    <td className="text-fg-muted">
                      {new Date(b.dueDate).toLocaleDateString()}
                    </td>
                    <td className="tabular-nums">
                      ${(b.amount / 100).toFixed(2)}
                    </td>
                    <td className="w-32">
                      {sel ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={sel.payAmount}
                          onChange={(e) =>
                            setSelected((prev) => ({
                              ...prev,
                              [b.id]: {
                                bill: b,
                                payAmount: Number(e.target.value),
                              },
                            }))
                          }
                        />
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                      {rowError && (
                        <span
                          className="mt-0.5 block text-[10px] text-error"
                          title={rowError}
                        >
                          ⚠ {rowError}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="py-2 text-right text-xs uppercase tracking-widest text-fg-muted">
                  Total to post
                </td>
                <td className="tabular-nums font-bold text-fg">
                  ${(totalCents / 100).toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>

          <WarningInline
            warnings={computeWarnings(
              {
                bankAccountId,
                paymentMethod: method,
                checkNumber,
              },
              "BillPayment",
            )}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Posting…" : "Post payments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
