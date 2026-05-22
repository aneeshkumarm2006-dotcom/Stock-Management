// Record bill modal — A/P entry point ([G-S-34]). Used by the Bills list
// and (later) the Pay bills workflow. Always submits with `status='Due'`
// so the JE posts immediately; PMs use the Drafts queue for unposted bills.
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

interface RecordBillModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  /** When provided the modal pre-selects this WO so the new bill links back. */
  workOrderId?: string;
}

export function RecordBillModal({
  open,
  onClose,
  onSaved,
  workOrderId,
}: RecordBillModalProps) {
  const { toast } = useToast();
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [accounts, setAccounts] = React.useState<ChartOfAccountOption[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);

  const [vendorId, setVendorId] = React.useState("");
  const [dueDate, setDueDate] = React.useState(() =>
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [refNo, setRefNo] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [scopeType, setScopeType] = React.useState<"Property" | "Company">(
    "Company",
  );
  const [scopeId, setScopeId] = React.useState<string>("");
  const [statusOnSave, setStatusOnSave] = React.useState<"Draft" | "Due">(
    "Due",
  );
  const [lines, setLines] = React.useState<LineRow[]>([
    { accountId: "", description: "", amount: 0 },
  ]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok) setVendors((await r.json()) as VendorOption[]);
    });
    fetch("/api/pm/chart-of-accounts").then(async (r) => {
      if (r.ok) setAccounts((await r.json()) as ChartOfAccountOption[]);
    });
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) setProperties((await r.json()) as PropertyOption[]);
    });
  }, [open]);

  function reset() {
    setVendorId("");
    setDueDate(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    );
    setRefNo("");
    setMemo("");
    setScopeType("Company");
    setScopeId("");
    setStatusOnSave("Due");
    setLines([{ accountId: "", description: "", amount: 0 }]);
  }

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
      lines.map((l, i) =>
        i === idx ? ({ ...l, [key]: value } as LineRow) : l,
      ),
    );
  }

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  async function save() {
    if (!vendorId) {
      toast({ title: "Vendor is required", variant: "error" });
      return;
    }
    if (lines.filter((l) => l.accountId).length === 0) {
      toast({ title: "Add at least one line with an account", variant: "error" });
      return;
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      vendorId,
      dueDate: new Date(dueDate).toISOString(),
      refNo: refNo.trim() || undefined,
      memo: memo.trim() || undefined,
      status: statusOnSave,
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
    if (workOrderId) body.workOrderId = workOrderId;
    const res = await fetch("/api/pm/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({
      title: statusOnSave === "Draft" ? "Draft bill saved" : "Bill posted",
      variant: "success",
    });
    reset();
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader title="Record bill" onClose={onClose} />
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="bill-vendor">Vendor *</Label>
              <select
                id="bill-vendor"
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
              <Label htmlFor="bill-due">Due date *</Label>
              <Input
                id="bill-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="bill-ref">Reference / invoice #</Label>
              <Input
                id="bill-ref"
                value={refNo}
                onChange={(e) => setRefNo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bill-status">Save as</Label>
              <select
                id="bill-status"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={statusOnSave}
                onChange={(e) =>
                  setStatusOnSave(e.target.value as "Draft" | "Due")
                }
              >
                <option value="Due">Post (status Due)</option>
                <option value="Draft">Draft (no GL impact)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="bill-scope">Scope</Label>
            <div className="flex gap-2">
              <select
                id="bill-scope"
                className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={scopeType}
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
            <Label htmlFor="bill-memo">Memo</Label>
            <textarea
              id="bill-memo"
              className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
              rows={2}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-widest text-fg-muted">
                Lines
              </h4>
              <Button size="sm" variant="outline" onClick={addLine}>
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
                        onChange={(e) =>
                          updateLine(i, "amount", Number(e.target.value))
                        }
                      />
                    </td>
                    <td className="w-8 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="text-fg-muted hover:text-error"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="py-2 text-right text-xs uppercase tracking-widest text-fg-muted">
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : statusOnSave === "Draft" ? "Save draft" : "Post bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
