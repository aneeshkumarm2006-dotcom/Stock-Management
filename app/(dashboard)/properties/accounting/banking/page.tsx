// /properties/accounting/banking — Banking landing.
// Sibling tabs: Bank accounts | Credit cards (DECISIONS.md [G-S-29]).
// Register + Reconciliation flows ship in Phase 2/9.
"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import type { BankAccountType } from "@/types/pm";

interface BankRow {
  id: string;
  name: string;
  purpose: string;
  accountNumberMasked: string;
  type: BankAccountType;
  epayEnabled: boolean;
  retailCashEnabled: boolean;
  isCompanyCash: boolean;
  isDefault: boolean;
  active: boolean;
  undepositedFunds: boolean;
}

interface CardRow {
  id: string;
  name: string;
  cardNumberMasked: string;
  issuer: string;
  expirationDate: string | null;
  active: boolean;
}

export default function BankingPage() {
  return (
    <Tabs defaultValue="banks">
      <div className="mb-4 flex items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="banks">Bank accounts</TabsTrigger>
          <TabsTrigger value="cards">Credit cards</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="banks">
        <BankAccountsTab />
      </TabsContent>
      <TabsContent value="cards">
        <CreditCardsTab />
      </TabsContent>
    </Tabs>
  );
}

// -----------------------------------------------------------------------------
// Bank accounts
// -----------------------------------------------------------------------------

function BankAccountsTab() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<BankRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [showInactive, setShowInactive] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(
      `/api/pm/bank-accounts${showInactive ? "?includeInactive=1" : ""}`,
    );
    if (r.ok) setRows((await r.json()) as BankRow[]);
    setLoading(false);
  }, [showInactive]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function archive(id: string) {
    const res = await fetch(`/api/pm/bank-accounts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Archive failed", variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank accounts</CardTitle>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-bold text-fg-muted">
            ({rows.length})
          </span>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add bank account
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-fg-muted">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-fg-muted">
            No bank accounts yet. Add one to enable Property setup.
          </p>
        )}
        {!loading && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Name</th>
                <th>Type</th>
                <th>Account #</th>
                <th>Flags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={
                    "border-b border-border/40 " + (r.active ? "" : "opacity-50")
                  }
                >
                  <td className="py-2 text-fg">
                    <Link
                      href={`/properties/accounting/banking/${r.id}`}
                      className="hover:underline"
                    >
                      <span className="flex items-center gap-2">
                        <span className="block font-medium">{r.name}</span>
                        {r.undepositedFunds && (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning"
                            title="Receipts not yet rolled into a deposit (BR-AC-7)"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Undeposited
                          </span>
                        )}
                      </span>
                      {r.purpose && (
                        <span className="text-xs italic text-fg-muted">
                          {r.purpose}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="text-fg-muted">{r.type}</td>
                  <td className="text-fg-muted tabular-nums">
                    {r.accountNumberMasked}
                  </td>
                  <td className="text-xs text-fg-muted">
                    {[
                      r.epayEnabled && "ePay",
                      r.retailCashEnabled && "Retail cash",
                      r.isCompanyCash && "Company cash",
                      r.isDefault && "Default",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => archive(r.id)}
                      disabled={!r.active}
                      className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Archive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
      <AddBankAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </Card>
  );
}

function AddBankAccountModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    name: "",
    purpose: "",
    accountNumberMasked: "",
    type: "Checking" as BankAccountType,
    epayEnabled: false,
    retailCashEnabled: false,
    isCompanyCash: false,
    isDefault: false,
  });
  const [saving, setSaving] = React.useState(false);

  function reset() {
    setForm({
      name: "",
      purpose: "",
      accountNumberMasked: "",
      type: "Checking",
      epayEnabled: false,
      retailCashEnabled: false,
      isCompanyCash: false,
      isDefault: false,
    });
  }

  async function save() {
    if (!form.name.trim() || !form.accountNumberMasked.trim()) {
      toast({ title: "Name + masked number required", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        name: form.name.trim(),
        purpose: form.purpose.trim() || undefined,
        accountNumberMasked: form.accountNumberMasked.trim(),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: Record<string, string[]>;
      };
      const issueMsg = err.issues
        ? Object.values(err.issues).flat().join("; ")
        : err.error;
      toast({ title: "Failed", description: issueMsg, variant: "error" });
      return;
    }
    toast({ title: "Bank account added", variant: "success" });
    reset();
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Add bank account" onClose={onClose} />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ba-name">Name *</Label>
            <Input
              id="ba-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Company checking"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ba-purpose">Purpose</Label>
            <Input
              id="ba-purpose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              placeholder="Operating cash"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ba-num">Account # (masked) *</Label>
              <Input
                id="ba-num"
                value={form.accountNumberMasked}
                onChange={(e) =>
                  setForm({ ...form, accountNumberMasked: e.target.value })
                }
                placeholder="****1234"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ba-type">Type *</Label>
              <select
                id="ba-type"
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as BankAccountType })
                }
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="Checking">Checking</option>
                <option value="Savings">Savings</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={form.epayEnabled}
                onChange={(e) =>
                  setForm({ ...form, epayEnabled: e.target.checked })
                }
              />
              ePay enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={form.retailCashEnabled}
                onChange={(e) =>
                  setForm({ ...form, retailCashEnabled: e.target.checked })
                }
              />
              Retail cash enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={form.isCompanyCash}
                onChange={(e) =>
                  setForm({ ...form, isCompanyCash: e.target.checked })
                }
              />
              Include in Company cash
            </label>
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) =>
                  setForm({ ...form, isDefault: e.target.checked })
                }
              />
              Default for management fees
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Credit cards
// -----------------------------------------------------------------------------

function CreditCardsTab() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<CardRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/credit-cards");
    if (r.ok) setRows((await r.json()) as CardRow[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function archive(id: string) {
    const res = await fetch(`/api/pm/credit-cards/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Archive failed", variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credit cards</CardTitle>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add credit card
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-fg-muted">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-fg-muted">No credit cards yet.</p>
        )}
        {!loading && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Name</th>
                <th>Issuer</th>
                <th>Card #</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="py-2 text-fg">{r.name}</td>
                  <td className="text-fg-muted">{r.issuer || "—"}</td>
                  <td className="text-fg-muted tabular-nums">
                    {r.cardNumberMasked}
                  </td>
                  <td className="text-fg-muted">
                    {r.expirationDate
                      ? new Date(r.expirationDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => archive(r.id)}
                      className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error"
                      aria-label="Archive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
      <AddCreditCardModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </Card>
  );
}

function AddCreditCardModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    name: "",
    cardNumberMasked: "",
    issuer: "",
    expirationDate: "",
  });
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!form.name.trim() || !form.cardNumberMasked.trim()) {
      toast({ title: "Name + masked number required", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/credit-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        cardNumberMasked: form.cardNumberMasked.trim(),
        issuer: form.issuer.trim() || undefined,
        expirationDate: form.expirationDate
          ? new Date(form.expirationDate).toISOString()
          : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Credit card added", variant: "success" });
    setForm({ name: "", cardNumberMasked: "", issuer: "", expirationDate: "" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title="Add credit card" onClose={onClose} />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cc-name">Name *</Label>
            <Input
              id="cc-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-num">Card # (masked) *</Label>
            <Input
              id="cc-num"
              value={form.cardNumberMasked}
              onChange={(e) =>
                setForm({ ...form, cardNumberMasked: e.target.value })
              }
              placeholder="****1234"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cc-issuer">Issuer</Label>
              <Input
                id="cc-issuer"
                value={form.issuer}
                onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                placeholder="Visa"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-exp">Expires</Label>
              <Input
                id="cc-exp"
                type="date"
                value={form.expirationDate}
                onChange={(e) =>
                  setForm({ ...form, expirationDate: e.target.value })
                }
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

