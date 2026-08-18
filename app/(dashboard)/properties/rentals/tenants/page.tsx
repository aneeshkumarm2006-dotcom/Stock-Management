// /properties/rentals/tenants — list view (skeleton).
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteTenantDialog } from "@/components/pm/DeleteTenantDialog";
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
import { compareCountryGroups } from "@/lib/pm/country";

interface TenantRow {
  id: string;
  tenantType: "Individual" | "Company";
  firstName: string;
  lastName: string;
  companyName: string;
  contactPersonName: string;
  email: string;
  cosignerFlag: boolean;
  displayName: string;
  active: boolean;
  currentLease: {
    propertyId: string;
    propertyName: string;
    unitName: string;
    /** Already bucketed by the API via normalizeCountry. */
    country: string;
    companyAccountId: string | null;
    companyName: string | null;
  } | null;
}

type ActiveFilter = "active" | "inactive" | "all";

// Mirrors PropertyGroupBy on the properties list. Every dimension here hangs
// off the tenant's CURRENT active lease, which is also what the Property /
// Unit column shows — so a section always agrees with the rows under it.
type TenantGroupBy = "none" | "property" | "country" | "company";

const GROUP_BY_OPTIONS: Array<[TenantGroupBy, string]> = [
  ["none", "None"],
  ["property", "Property"],
  ["country", "Country"],
  ["company", "Company"],
];

// Tenants between leases have no property to group under. They get their own
// bucket pinned last, matching the Unowned/Unassigned rule on the properties
// list. Deliberately distinct from the country bucket "Other", which means
// "a country we don't recognise" rather than "no lease".
const NO_LEASE = "__unassigned";
const NO_LEASE_LABEL = "No current lease";

export default function TenantsPage() {
  const [rows, setRows] = React.useState<TenantRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<ActiveFilter>("active");
  // Grouped by default (as the rent roll is) — the flat list gave no hint
  // that tenants cluster by property.
  const [groupBy, setGroupBy] = React.useState<TenantGroupBy>("property");
  const [search, setSearch] = React.useState("");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<TenantRow | null>(null);

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

  // Section the visible rows by property, country or parent company. "none"
  // is a single unlabeled group, so the table below renders one code path
  // either way. Same Map → sort shape as the properties list.
  const groups = React.useMemo<
    Array<{ key: string; label: string; rows: TenantRow[] }>
  >(() => {
    if (groupBy === "none") {
      return [{ key: "all", label: "", rows: visible }];
    }

    // One pass, keyed per dimension; tenants with no current lease always
    // fall into NO_LEASE regardless of which dimension is selected.
    const m = new Map<string, { label: string; rows: TenantRow[] }>();
    for (const t of visible) {
      const lease = t.currentLease;
      let key = NO_LEASE;
      let label = NO_LEASE_LABEL;
      if (lease) {
        if (groupBy === "property") {
          key = lease.propertyId;
          label = lease.propertyName;
        } else if (groupBy === "country") {
          key = lease.country;
          label = lease.country;
        } else {
          key = lease.companyAccountId ?? "__nocompany";
          label = lease.companyName ?? "Unassigned";
        }
      }
      const g = m.get(key) ?? { label, rows: [] };
      g.rows.push(t);
      m.set(key, g);
    }

    return Array.from(m.entries())
      .map(([key, v]) => ({ key, label: v.label, rows: v.rows }))
      .sort((a, b) => {
        // "No current lease" and an unset company both pin last.
        if (a.key === NO_LEASE) return 1;
        if (b.key === NO_LEASE) return -1;
        if (a.key === "__nocompany") return 1;
        if (b.key === "__nocompany") return -1;
        return groupBy === "country"
          ? compareCountryGroups(a.label, b.label)
          : a.label.localeCompare(b.label);
      });
  }, [visible, groupBy]);

  const renderTenantRow = (t: TenantRow) => (
    <tr
      key={t.id}
      className={"border-b border-border/40 " + (t.active ? "" : "opacity-50")}
    >
      <td className="py-2 text-fg">
        <Link
          href={`/properties/rentals/tenants/${t.id}`}
          className="font-medium hover:underline"
        >
          {t.displayName}
        </Link>
        {t.tenantType === "Company" && t.contactPersonName && (
          <span className="block text-xs text-fg-muted">
            Contact: {t.contactPersonName}
          </span>
        )}
      </td>
      <td className="text-fg-muted">
        <span
          className={
            "inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide " +
            (t.tenantType === "Company"
              ? "border-primary/40 text-primary"
              : "border-border text-fg-muted")
          }
        >
          {t.tenantType === "Company" ? "Company" : "Individual"}
        </span>
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
      <td className="text-right">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete ${t.displayName}`}
          className="text-fg-muted hover:text-error"
          onClick={() => setDeleteTarget(t)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );

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
            <span className="ml-2 text-xs text-fg-muted">·</span>
            <span className="text-xs text-fg-muted">Group by</span>
            {GROUP_BY_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setGroupBy(value)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-bold transition-colors " +
                  (groupBy === value
                    ? "border-primary bg-primary text-primary-fg"
                    : "border-border bg-surface text-fg-muted hover:text-fg")
                }
              >
                {label}
              </button>
            ))}
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
                <th>Type</th>
                <th>Email</th>
                <th>Role</th>
                <th>Property / Unit</th>
                <th className="w-10" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    No tenants match.
                  </td>
                </tr>
              )}
              {!loading &&
                visible.length > 0 &&
                groups.map((g) => (
                  <React.Fragment key={g.key}>
                    {groupBy !== "none" && (
                      <tr className="bg-surface-high/40">
                        <td
                          colSpan={6}
                          className="py-1.5 text-xs font-bold uppercase tracking-widest text-fg-muted"
                        >
                          {g.label}
                          <span className="ml-2 font-normal normal-case tracking-normal">
                            {g.rows.length} tenant
                            {g.rows.length === 1 ? "" : "s"}
                          </span>
                        </td>
                      </tr>
                    )}
                    {g.rows.map(renderTenantRow)}
                  </React.Fragment>
                ))}
            </tbody>
          </table>
          <p className="text-xs text-fg-muted">
            Match count: {visible.length} of {rows.length} loaded.
          </p>
          <p className="text-xs text-fg-muted">
            Property / unit reflects each tenant’s current active lease, and
            drives the grouping above. Assign a tenant from their detail page or
            from a property’s Units tab.
          </p>
        </CardContent>
      </Card>

      <AddTenantModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />

      <DeleteTenantDialog
        tenant={
          deleteTarget
            ? {
                id: deleteTarget.id,
                displayName: deleteTarget.displayName,
                active: deleteTarget.active,
              }
            : null
        }
        onClose={() => setDeleteTarget(null)}
        onDeleted={load}
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
  const emptyForm = {
    tenantType: "Individual" as "Individual" | "Company",
    firstName: "",
    lastName: "",
    companyName: "",
    contactPersonName: "",
    email: "",
    cosignerFlag: false,
  };
  const [form, setForm] = React.useState(emptyForm);
  const [saving, setSaving] = React.useState(false);
  const isCompany = form.tenantType === "Company";

  async function save() {
    if (isCompany) {
      if (!form.companyName.trim()) {
        toast({ title: "Company name required", variant: "error" });
        return;
      }
    } else if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name required", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantType: form.tenantType,
        firstName: isCompany ? undefined : form.firstName.trim(),
        lastName: isCompany ? undefined : form.lastName.trim(),
        companyName: isCompany ? form.companyName.trim() : undefined,
        contactPersonName:
          isCompany && form.contactPersonName.trim()
            ? form.contactPersonName.trim()
            : undefined,
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
    setForm(emptyForm);
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title="Add tenant" onClose={onClose} />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="t-type">Tenant type</Label>
            <select
              id="t-type"
              className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
              value={form.tenantType}
              onChange={(e) =>
                setForm({
                  ...form,
                  tenantType: e.target.value as "Individual" | "Company",
                })
              }
            >
              <option value="Individual">Individual</option>
              <option value="Company">Company</option>
            </select>
          </div>

          {isCompany ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="t-company">Company name *</Label>
                <Input
                  id="t-company"
                  value={form.companyName}
                  onChange={(e) =>
                    setForm({ ...form, companyName: e.target.value })
                  }
                  placeholder="Acme Holdings Inc."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-contact">Contact person</Label>
                <Input
                  id="t-contact"
                  value={form.contactPersonName}
                  onChange={(e) =>
                    setForm({ ...form, contactPersonName: e.target.value })
                  }
                  placeholder="Jane Doe"
                />
              </div>
            </>
          ) : (
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
          )}
          <div className="space-y-1">
            <Label htmlFor="t-email">
              {isCompany ? "Contact email" : "Email"}
            </Label>
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
