// Edit bill modal — full edit of a recorded bill ([G-S-34] follow-up). Mirrors
// RecordBillModal but loads an existing bill, PATCHes /api/pm/bills/:id, and
// never sends `status` (status transitions live on the Post button, the Pay
// bills flow, and the void flow). When a *posted* bill's financially-material
// fields change the API reverses the accrual JE and re-posts a fresh one. Bills
// with applied payments (Partially paid / Paid) lock their financial fields
// here; the API enforces the same with a 409.
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

interface VendorOption {
  id: string;
  displayName: string;
}
interface ChartOfAccountOption {
  id: string;
  name: string;
  isGroup?: boolean;
}
interface PropertyOption {
  id: string;
  propertyName: string;
}

interface LineRow {
  accountId: string;
  description: string;
  amount: number;
}

interface BillDetailResponse {
  vendorId: string | null;
  invoiceDate: string;
  status: string;
  memo: string;
  refNo: string;
  scope: { type: string; id: string | null } | null;
  lines: { accountId: string; description: string; amount: number }[];
}

interface EditBillModalProps {
  open: boolean;
  billId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function EditBillModal({
  open,
  billId,
  onClose,
  onSaved,
}: EditBillModalProps) {
  const { toast } = useToast();
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [accounts, setAccounts] = React.useState<ChartOfAccountOption[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);

  const [loading, setLoading] = React.useState(true);
  const [vendorId, setVendorId] = React.useState("");
  const [invoiceDate, setInvoiceDate] = React.useState("");
  const [refNo, setRefNo] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [scopeType, setScopeType] = React.useState<"Property" | "Company">(
    "Company",
  );
  const [scopeId, setScopeId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [lines, setLines] = React.useState<LineRow[]>([]);
  const [saving, setSaving] = React.useState(false);

  // Partially paid / Paid bills have separate, immutable payment JEs that a
  // re-post can't keep in sync — only vendor and reference are editable.
  const lockedFinancials = status === "Partially paid" || status === "Paid";

  React.useEffect(() => {
    if (!open || !billId) return;
    setLoading(true);
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok) setVendors((await r.json()) as VendorOption[]);
    });
    fetch("/api/pm/chart-of-accounts").then(async (r) => {
      if (r.ok) {
        const all = (await r.json()) as ChartOfAccountOption[];
        // Group/header rows are non-postable — keep them out of the picker.
        setAccounts(all.filter((a) => !a.isGroup));
      }
    });
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) setProperties((await r.json()) as PropertyOption[]);
    });
    fetch(`/api/pm/bills/${billId}`).then(async (r) => {
      if (r.ok) {
        const b = (await r.json()) as BillDetailResponse;
        setVendorId(b.vendorId ?? "");
        setInvoiceDate(b.invoiceDate ? b.invoiceDate.slice(0, 10) : "");
        setRefNo(b.refNo ?? "");
        setMemo(b.memo ?? "");
        setScopeType(b.scope?.type === "Property" ? "Property" : "Company");
        setScopeId(b.scope?.id ?? "");
        setStatus(b.status);
        setLines(
          (b.lines ?? []).map((l) => ({
            accountId: l.accountId,
            description: l.description ?? "",
            amount: l.amount / 100, // cents → dollars for the form
          })),
        );
      }
      setLoading(false);
    });
  }, [open, billId]);

  function addLine() {
    setLines([...lines, { accountId: "", description: "", amount: 0 }]);
  }
  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }
  function updateLine<K extends keyof LineRow>(
    idx: number,
    key: K,
    value: LineRow[K],
  ) {
    setLines(
      lines.map((l, i) => (i === idx ? ({ ...l, [key]: value } as LineRow) : l)),
    );
  }

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  async function save() {
    if (!vendorId) {
      toast({ title: "Vendor is required", variant: "error" });
      return;
    }

    let body: Record<string, unknown>;
    if (lockedFinancials) {
      // Only metadata is editable; sending nothing material avoids the 409.
      body = { vendorId, refNo: refNo.trim() || undefined };
    } else {
      if (lines.filter((l) => l.accountId).length === 0) {
        toast({
          title: "Add at least one line with an account",
          variant: "error",
        });
        return;
      }
      body = {
        vendorId,
        invoiceDate: new Date(invoiceDate).toISOString(),
        refNo: refNo.trim() || undefined,
        memo: memo.trim() || undefined,
        scope:
          scopeType === "Property" && scopeId
            ? { type: "Property", id: scopeId }
            : { type: "Company", id: null },
        lines: lines
          .filter((l) => l.accountId)
          .map((l) => ({
            accountId: l.accountId,
            description: l.description.trim() || undefined,
            amount: Number(l.amount) || 0,
          })),
      };
    }

    setSaving(true);
    const res = await fetch(`/api/pm/bills/${billId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      // 409 (payments applied) and 423 (locked period) both carry `error`.
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Save failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Bill updated", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader title="Edit bill" onClose={onClose} />
        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <div className="space-y-4">
            {lockedFinancials && (
              <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg-muted">
                This bill has payments applied. Only the vendor and reference can
                be edited here. To change amounts, dates, scope, or memo, void the
                payments first.
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="edit-bill-vendor">Vendor *</Label>
                <select
                  id="edit-bill-vendor"
                  className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                >
                  <option value="">Choose vendor…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-bill-invoice">Invoice date *</Label>
                <Input
                  id="edit-bill-invoice"
                  type="date"
                  value={invoiceDate}
                  disabled={lockedFinancials}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="edit-bill-ref">Reference / invoice #</Label>
                <Input
                  id="edit-bill-ref"
                  value={refNo}
                  onChange={(e) => setRefNo(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-bill-scope">Scope</Label>
              <div className="flex gap-2">
                <select
                  id="edit-bill-scope"
                  className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                  value={scopeType}
                  disabled={lockedFinancials}
                  onChange={(e) => {
                    setScopeType(e.target.value as "Property" | "Company");
                    setScopeId("");
                  }}
                >
                  <option value="Company">Company</option>
                  <option value="Property">Property</option>
                </select>
                {scopeType === "Property" && (
                  <select
                    className="flex-1 rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                    value={scopeId}
                    disabled={lockedFinancials}
                    onChange={(e) => setScopeId(e.target.value)}
                  >
                    <option value="">Choose property…</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.propertyName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-bill-memo">Memo</Label>
              <textarea
                id="edit-bill-memo"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                rows={2}
                value={memo}
                disabled={lockedFinancials}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold uppercase tracking-widest text-fg-muted">
                  Lines
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addLine}
                  disabled={lockedFinancials}
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
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
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-1 w-56">
                        <select
                          className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
                          value={l.accountId}
                          disabled={lockedFinancials}
                          onChange={(e) =>
                            updateLine(i, "accountId", e.target.value)
                          }
                        >
                          <option value="">Choose…</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Input
                          value={l.description}
                          disabled={lockedFinancials}
                          onChange={(e) =>
                            updateLine(i, "description", e.target.value)
                          }
                        />
                      </td>
                      <td className="w-32">
                        <Input
                          type="number"
                          step="0.01"
                          value={l.amount}
                          disabled={lockedFinancials}
                          onChange={(e) =>
                            updateLine(i, "amount", Number(e.target.value))
                          }
                        />
                      </td>
                      <td className="w-8 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          disabled={lockedFinancials}
                          className="text-fg-muted hover:text-error disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      colSpan={2}
                      className="py-2 text-right text-xs uppercase tracking-widest text-fg-muted"
                    >
                      Total
                    </td>
                    <td className="tabular-nums font-bold text-fg">
                      ${total.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
