// /properties/accounting/locked-periods — admin settings for accounting
// period locks (PDR §3.27, BR-AC-3). Admin-only writes; FinancialAdministrator
// users override locks at write-time via assertWriteAllowed, not here.
"use client";

import * as React from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

interface PolicyRow {
  id: string;
  scope: "Global" | "Per-property";
  propertyId: string | null;
  fromDate: string | null;
  toDate: string | null;
  message: string;
  active: boolean;
  createdAt: string;
}

interface PropertyOption {
  id: string;
  name: string;
}

export default function LockedPeriodsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<PolicyRow[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/locked-periods");
    if (r.ok) setRows((await r.json()) as PolicyRow[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
    fetch("/api/pm/properties")
      .then((r) => (r.ok ? r.json() : []))
      .then((p: { id: string; propertyName: string }[]) =>
        setProperties(p.map((row) => ({ id: row.id, name: row.propertyName }))),
      );
  }, [load]);

  async function archive(id: string) {
    const res = await fetch(`/api/pm/locked-periods/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Archive failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Policy archived", variant: "success" });
    await load();
  }

  async function toggleActive(row: PolicyRow) {
    const res = await fetch(`/api/pm/locked-periods/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !row.active }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Toggle failed", description: err.error, variant: "error" });
      return;
    }
    await load();
  }

  const propertyName = (id: string | null) =>
    id ? properties.find((p) => p.id === id)?.name ?? "Property" : "—";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Locked periods</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add locked period
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-center gap-1 text-xs text-fg-muted">
            <Lock className="h-3 w-3" /> Ordinary users cannot post / edit
            transactions dated inside an active window. FinancialAdministrator
            (or Admin) users override at write time.
          </p>
          {loading && <p className="text-sm text-fg-muted">Loading…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-fg-muted">
              No locked periods configured. Add one to enforce period close.
            </p>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-2">Scope</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Message</th>
                  <th>Active</th>
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
                      {r.scope === "Global"
                        ? "Global"
                        : `Property — ${propertyName(r.propertyId)}`}
                    </td>
                    <td className="text-fg-muted">
                      {r.fromDate
                        ? new Date(r.fromDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="text-fg-muted">
                      {r.toDate ? new Date(r.toDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="text-fg-muted">{r.message || "—"}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => toggleActive(r)}
                        className={
                          "rounded px-2 py-0.5 text-[10px] font-bold uppercase " +
                          (r.active
                            ? "bg-success/15 text-success"
                            : "bg-fg-muted/15 text-fg-muted")
                        }
                      >
                        {r.active ? "Active" : "Off"}
                      </button>
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
      </Card>
      <AddLockedPeriodModal
        open={modalOpen}
        properties={properties}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

function AddLockedPeriodModal({
  open,
  properties,
  onClose,
  onSaved,
}: {
  open: boolean;
  properties: PropertyOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    scope: "Global" as "Global" | "Per-property",
    propertyId: "",
    fromDate: "",
    toDate: "",
    message: "",
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setForm({
        scope: "Global",
        propertyId: "",
        fromDate: "",
        toDate: "",
        message: "",
      });
    }
  }, [open]);

  async function save() {
    if (form.scope === "Per-property" && !form.propertyId) {
      toast({ title: "Pick a property", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/locked-periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: form.scope,
        propertyId: form.scope === "Per-property" ? form.propertyId : null,
        fromDate: form.fromDate || null,
        toDate: form.toDate || null,
        message: form.message.trim() || undefined,
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
        : err.error ?? "Failed";
      toast({ title: "Save failed", description: issueMsg, variant: "error" });
      return;
    }
    toast({ title: "Locked period created", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Add locked period" onClose={onClose} />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="lp-scope">Scope *</Label>
            <select
              id="lp-scope"
              value={form.scope}
              onChange={(e) =>
                setForm({
                  ...form,
                  scope: e.target.value as "Global" | "Per-property",
                  propertyId: "",
                })
              }
              className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
            >
              <option value="Global">Global (all properties + company)</option>
              <option value="Per-property">Per-property</option>
            </select>
          </div>
          {form.scope === "Per-property" && (
            <div className="space-y-1">
              <Label htmlFor="lp-prop">Property *</Label>
              <select
                id="lp-prop"
                value={form.propertyId}
                onChange={(e) =>
                  setForm({ ...form, propertyId: e.target.value })
                }
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="">— pick —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="lp-from">From</Label>
              <Input
                id="lp-from"
                type="date"
                value={form.fromDate}
                onChange={(e) =>
                  setForm({ ...form, fromDate: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lp-to">To</Label>
              <Input
                id="lp-to"
                type="date"
                value={form.toDate}
                onChange={(e) => setForm({ ...form, toDate: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-fg-muted">
            Leave bounds blank for open-ended locks (e.g. &ldquo;until further
            notice&rdquo;). Both blank locks everything while active.
          </p>
          <div className="space-y-1">
            <Label htmlFor="lp-message">Banner message</Label>
            <Input
              id="lp-message"
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Books closed for FY2025"
              maxLength={500}
            />
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
