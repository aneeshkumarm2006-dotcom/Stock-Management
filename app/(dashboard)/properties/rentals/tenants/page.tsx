// /properties/rentals/tenants — list view (skeleton).
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
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

interface TenantRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cosignerFlag: boolean;
  displayName: string;
  active: boolean;
  currentLease: {
    propertyId: string;
    propertyName: string;
    unitName: string;
  } | null;
}

type ActiveFilter = "active" | "inactive" | "all";

export default function TenantsPage() {
  const [rows, setRows] = React.useState<TenantRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<ActiveFilter>("active");
  const [search, setSearch] = React.useState("");
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "active") params.set("includeInactive", "1");
    if (search.trim()) params.set("q", search.trim());
    const r = await fetch(`/api/pm/tenants?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as TenantRow[]);
    setLoading(false);
  }, [filter, search]);

  React.useEffect(() => {
    load();
  }, [load]);

  const visible = React.useMemo(() => {
    if (filter === "active") return rows.filter((r) => r.active);
    if (filter === "inactive") return rows.filter((r) => !r.active);
    return rows;
  }, [rows, filter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Tenants</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add tenant
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <FilterChip
              label="Active"
              count={rows.filter((r) => r.active).length}
              selected={filter === "active"}
              onClick={() => setFilter("active")}
            />
            <FilterChip
              label="Inactive"
              count={rows.filter((r) => !r.active).length}
              selected={filter === "inactive"}
              onClick={() => setFilter("inactive")}
            />
            <FilterChip
              label="All"
              count={rows.length}
              selected={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <div className="ml-auto w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Property / Unit</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-fg-muted">
                    No tenants match.
                  </td>
                </tr>
              )}
              {visible.map((t) => (
                <tr
                  key={t.id}
                  className={
                    "border-b border-border/40 " + (t.active ? "" : "opacity-50")
                  }
                >
                  <td className="py-2 text-fg">
                    <Link
                      href={`/properties/rentals/tenants/${t.id}`}
                      className="font-medium hover:underline"
                    >
                      {t.displayName}
                    </Link>
                  </td>
                  <td className="text-fg-muted">{t.email || "—"}</td>
                  <td className="text-fg-muted">
                    {t.cosignerFlag ? "Cosigner" : "Tenant"}
                  </td>
                  <td className="text-fg-muted">
                    {t.currentLease ? (
                      <Link
                        href={`/properties/rentals/properties/${t.currentLease.propertyId}`}
                        className="hover:underline"
                      >
                        {t.currentLease.propertyName} · {t.currentLease.unitName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-fg-muted">
            Property / unit reflects each tenant’s current active lease. Assign a
            tenant from their detail page or from a property’s Units tab.
          </p>
        </CardContent>
      </Card>

      <AddTenantModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors " +
        (selected
          ? "border-primary bg-primary text-primary-fg"
          : "border-border bg-surface text-fg-muted hover:text-fg")
      }
    >
      {label}
      <span
        className={
          "rounded-full px-1.5 text-[10px] " +
          (selected
            ? "bg-primary-fg/20 text-primary-fg"
            : "bg-surface-high text-fg-muted")
        }
      >
        {count}
      </span>
    </button>
  );
}

function AddTenantModal({
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
    firstName: "",
    lastName: "",
    email: "",
    cosignerFlag: false,
  });
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name required", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        cosignerFlag: form.cosignerFlag,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Tenant added", variant: "success" });
    setForm({ firstName: "", lastName: "", email: "", cosignerFlag: false });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title="Add tenant" onClose={onClose} />
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="t-first">First name *</Label>
              <Input
                id="t-first"
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-last">Last name *</Label>
              <Input
                id="t-last"
                value={form.lastName}
                onChange={(e) =>
                  setForm({ ...form, lastName: e.target.value })
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-email">Email</Label>
            <Input
              id="t-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={form.cosignerFlag}
              onChange={(e) =>
                setForm({ ...form, cosignerFlag: e.target.checked })
              }
            />
            Add as cosigner
          </label>
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
