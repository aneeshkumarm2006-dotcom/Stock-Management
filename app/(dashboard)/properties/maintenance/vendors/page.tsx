// /properties/maintenance/vendors — list view (PDR §3.11).
// EXPIRES column (BR-MV-4) renders a yellow chip when insurance
// expiration is within 30 days; red when expired.
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
import { EditVendorModal } from "@/components/pm/EditVendorModal";
import { EditEntityButton } from "@/components/pm/EditEntityButton";

interface VendorRow {
  id: string;
  firstName: string;
  lastName: string;
  isCompany: boolean;
  companyName: string;
  primaryEmail: string;
  displayName: string;
  categoryId: string | null;
  insuranceProvider: string;
  insuranceExpirationDate: string | null;
  daysUntilInsuranceExpires: number | null;
  active: boolean;
}

type ActiveFilter = "active" | "inactive" | "all";

export default function VendorsPage() {
  const [rows, setRows] = React.useState<VendorRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<ActiveFilter>("active");
  const [search, setSearch] = React.useState("");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editVendorId, setEditVendorId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "active") params.set("includeInactive", "1");
    if (search.trim()) params.set("q", search.trim());
    const r = await fetch(`/api/pm/vendors?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as VendorRow[]);
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
          <CardTitle>Vendors</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add vendor
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
                <th>Insurance provider</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-fg-muted">
                    No vendors match.
                  </td>
                </tr>
              )}
              {visible.map((v) => (
                <tr
                  key={v.id}
                  className={
                    "border-b border-border/40 " + (v.active ? "" : "opacity-50")
                  }
                >
                  <td className="py-2 text-fg">
                    <Link
                      href={`/properties/maintenance/vendors/${v.id}`}
                      className="font-medium hover:underline"
                    >
                      {v.displayName}
                    </Link>
                  </td>
                  <td className="text-fg-muted">{v.primaryEmail || "—"}</td>
                  <td className="text-fg-muted">{v.insuranceProvider || "—"}</td>
                  <td className="text-fg-muted">
                    <ExpiresChip
                      endDate={v.insuranceExpirationDate}
                      days={v.daysUntilInsuranceExpires}
                    />
                  </td>
                  <td className="text-right">
                    <div className="inline-flex items-center gap-2">
                      {!v.active && (
                        <span className="text-xs text-fg-muted">Inactive</span>
                      )}
                      {v.active && (
                        <EditEntityButton
                          onClick={() => setEditVendorId(v.id)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AddVendorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
      <EditVendorModal
        open={Boolean(editVendorId)}
        vendorId={editVendorId}
        onClose={() => setEditVendorId(null)}
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

function ExpiresChip({
  endDate,
  days,
}: {
  endDate: string | null;
  days: number | null;
}) {
  if (!endDate) return <span>—</span>;
  const formatted = new Date(endDate).toLocaleDateString();
  if (days !== null && days < 0) {
    return (
      <span className="inline-flex items-center gap-2">
        {formatted}
        <span className="rounded bg-error/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-error">
          Expired
        </span>
      </span>
    );
  }
  if (days !== null && days <= 30) {
    return (
      <span className="inline-flex items-center gap-2">
        {formatted}
        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">
          {days} days
        </span>
      </span>
    );
  }
  return <span>{formatted}</span>;
}

function AddVendorModal({
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
    isCompany: false,
    companyName: "",
    primaryEmail: "",
  });
  const [saving, setSaving] = React.useState(false);

  function reset() {
    setForm({
      firstName: "",
      lastName: "",
      isCompany: false,
      companyName: "",
      primaryEmail: "",
    });
  }

  async function save() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name required", variant: "error" });
      return;
    }
    if (form.isCompany && !form.companyName.trim()) {
      toast({ title: "Company name required when isCompany", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        isCompany: form.isCompany,
        companyName: form.companyName.trim() || undefined,
        primaryEmail: form.primaryEmail.trim() || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Vendor added", variant: "success" });
    reset();
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Add vendor" onClose={onClose} />
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={form.isCompany}
              onChange={(e) =>
                setForm({ ...form, isCompany: e.target.checked })
              }
            />
            This is a company
          </label>
          {form.isCompany && (
            <div className="space-y-1">
              <Label htmlFor="v-company">Company name *</Label>
              <Input
                id="v-company"
                value={form.companyName}
                onChange={(e) =>
                  setForm({ ...form, companyName: e.target.value })
                }
              />
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="v-first">First name *</Label>
              <Input
                id="v-first"
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-last">Last name *</Label>
              <Input
                id="v-last"
                value={form.lastName}
                onChange={(e) =>
                  setForm({ ...form, lastName: e.target.value })
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-email">Primary email</Label>
            <Input
              id="v-email"
              type="email"
              value={form.primaryEmail}
              onChange={(e) =>
                setForm({ ...form, primaryEmail: e.target.value })
              }
            />
          </div>
          <p className="text-xs text-fg-muted">
            Phone numbers, address, category, insurance, tax fields, and 1099
            overrides can be edited from the detail page after creation.
          </p>
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
