// /properties/rentals/properties — Property list view.
// Live-count filter chips for Active/Inactive + Residential/Commercial.
// BR-CX-2 — match-counter respects filters.
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
import { AddressFields, emptyAddress } from "@/components/pm/AddressFields";
import {
  PropertyOwnershipEditor,
  type OwnershipRow,
} from "@/components/pm/PropertyOwnershipEditor";
import type {
  PropertyClass,
  PropertySubType,
  ResidentialSubType,
  CommercialSubType,
} from "@/types/pm";

interface PropertyRow {
  id: string;
  propertyName: string;
  propertyClass: PropertyClass;
  propertySubType: PropertySubType;
  address: {
    line1?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  propertyManagerUserId: string | null;
  ownerCount: number;
  active: boolean;
  propertyReserve: number;
  operatingAccountId: string | null;
}

const RES_SUBTYPES: ResidentialSubType[] = [
  "Single-Family",
  "Multi-Family",
  "Condo-Townhome",
];
const COM_SUBTYPES: CommercialSubType[] = ["Industrial", "Office", "Retail"];

export default function PropertiesListPage() {
  const [rows, setRows] = React.useState<PropertyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [filterActive, setFilterActive] = React.useState<
    "active" | "inactive" | "all"
  >("active");
  const [filterClass, setFilterClass] = React.useState<"" | PropertyClass>("");
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterActive !== "active") params.set("includeInactive", "1");
    if (filterClass) params.set("propertyClass", filterClass);
    if (search.trim()) params.set("q", search.trim());
    const r = await fetch(`/api/pm/properties?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as PropertyRow[]);
    setLoading(false);
  }, [filterActive, filterClass, search]);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = React.useMemo(() => {
    if (filterActive === "active") return rows.filter((r) => r.active);
    if (filterActive === "inactive") return rows.filter((r) => !r.active);
    return rows;
  }, [rows, filterActive]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Properties</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add property
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              label="Active"
              count={rows.filter((r) => r.active).length}
              selected={filterActive === "active"}
              onClick={() => setFilterActive("active")}
            />
            <Chip
              label="Inactive"
              count={rows.filter((r) => !r.active).length}
              selected={filterActive === "inactive"}
              onClick={() => setFilterActive("inactive")}
            />
            <Chip
              label="All"
              count={rows.length}
              selected={filterActive === "all"}
              onClick={() => setFilterActive("all")}
            />
            <span className="ml-2 text-xs text-fg-muted">·</span>
            <Chip
              label="Residential"
              count={rows.filter((r) => r.propertyClass === "Residential").length}
              selected={filterClass === "Residential"}
              onClick={() =>
                setFilterClass((c) =>
                  c === "Residential" ? "" : "Residential",
                )
              }
            />
            <Chip
              label="Commercial"
              count={rows.filter((r) => r.propertyClass === "Commercial").length}
              selected={filterClass === "Commercial"}
              onClick={() =>
                setFilterClass((c) => (c === "Commercial" ? "" : "Commercial"))
              }
            />
            <div className="ml-auto w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search properties"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Property</th>
                <th>Class / type</th>
                <th>Owners</th>
                <th>Address</th>
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
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-fg-muted">
                    No properties match.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className={
                    "border-b border-border/40 " +
                    (p.active ? "" : "opacity-50")
                  }
                >
                  <td className="py-2 text-fg">
                    <Link
                      href={`/properties/rentals/properties/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.propertyName}
                    </Link>
                    {!p.operatingAccountId && (
                      <span className="ml-2 text-xs font-medium text-amber-600">
                        Setup needed
                      </span>
                    )}
                  </td>
                  <td className="text-fg-muted">
                    {p.propertyClass}
                    <span className="px-1 text-fg-muted/50">·</span>
                    {p.propertySubType}
                  </td>
                  <td className="text-fg-muted">{p.ownerCount}</td>
                  <td className="text-fg-muted">
                    {p.address?.line1
                      ? `${p.address.line1}, ${p.address.city ?? ""} ${p.address.state ?? ""}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-fg-muted">
            Match count: {filtered.length} of {rows.length} loaded.
          </p>
        </CardContent>
      </Card>

      <AddPropertyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

function Chip({
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

interface BankOption {
  id: string;
  name: string;
  accountNumberMasked: string;
}

function AddPropertyModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [propertyName, setPropertyName] = React.useState("");
  const [propertyClass, setPropertyClass] = React.useState<PropertyClass>(
    "Residential",
  );
  const [propertySubType, setPropertySubType] = React.useState<PropertySubType>(
    "Single-Family",
  );
  const [address, setAddress] = React.useState(emptyAddress);
  const [banks, setBanks] = React.useState<BankOption[]>([]);
  const [operatingAccountId, setOperatingAccountId] = React.useState("");
  const [depositTrustAccountId, setDepositTrustAccountId] = React.useState("");
  const [propertyReserve, setPropertyReserve] = React.useState(0);
  const [owners, setOwners] = React.useState<OwnershipRow[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    fetch("/api/pm/bank-accounts")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: BankOption[]) => setBanks(rows));
  }, [open]);

  React.useEffect(() => {
    // Keep subType in the right subset when class flips.
    const valid =
      propertyClass === "Residential" ? RES_SUBTYPES : COM_SUBTYPES;
    if (!valid.includes(propertySubType as never)) {
      setPropertySubType(valid[0] as PropertySubType);
    }
  }, [propertyClass, propertySubType]);

  function reset() {
    setPropertyName("");
    setPropertyClass("Residential");
    setPropertySubType("Single-Family");
    setAddress(emptyAddress);
    setOperatingAccountId("");
    setDepositTrustAccountId("");
    setPropertyReserve(0);
    setOwners([]);
  }

  async function save() {
    if (!propertyName.trim()) {
      toast({ title: "Property name required", variant: "error" });
      return;
    }
    if (!address.line1 || !address.city || !address.state || !address.zip) {
      toast({ title: "Address line 1 / city / state / zip required", variant: "error" });
      return;
    }
    if (owners.length > 0) {
      const sum = owners.reduce(
        (a, r) => a + (Number.isFinite(r.ownershipPct) ? r.ownershipPct : 0),
        0,
      );
      if (Math.abs(sum - 100) > 0.01) {
        toast({
          title: "Owners must sum to 100%",
          description: `Currently ${sum}%`,
          variant: "error",
        });
        return;
      }
      if (owners.some((o) => !o.rentalOwnerId)) {
        toast({ title: "Pick an owner for every share row", variant: "error" });
        return;
      }
    }

    setSaving(true);
    const res = await fetch("/api/pm/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyName: propertyName.trim(),
        propertyClass,
        propertySubType,
        address: {
          ...address,
          state: address.state || undefined,
          country: address.country || "US",
        },
        operatingAccountId,
        depositTrustAccountId: depositTrustAccountId || null,
        propertyReserve: Number.isFinite(propertyReserve) ? propertyReserve : 0,
        rentalOwners: owners,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: Record<string, string[]>;
      };
      const issueMsg = err.issues
        ? Object.entries(err.issues)
            .map(([k, v]) => `${k}: ${v.join(", ")}`)
            .join("; ")
        : err.error;
      toast({ title: "Failed", description: issueMsg, variant: "error" });
      return;
    }
    toast({ title: "Property created", variant: "success" });
    reset();
    onClose();
    await onSaved();
  }

  const subTypes =
    propertyClass === "Residential" ? RES_SUBTYPES : COM_SUBTYPES;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader title="Add property" onClose={onClose} />
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="p-name">Property name *</Label>
            <Input
              id="p-name"
              value={propertyName}
              onChange={(e) => setPropertyName(e.target.value)}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="p-class">Class *</Label>
              <select
                id="p-class"
                value={propertyClass}
                onChange={(e) =>
                  setPropertyClass(e.target.value as PropertyClass)
                }
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="Residential">Residential</option>
                <option value="Commercial">Commercial</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-subtype">Sub-type *</Label>
              <select
                id="p-subtype"
                value={propertySubType}
                onChange={(e) =>
                  setPropertySubType(e.target.value as PropertySubType)
                }
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                {subTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-fg-muted">
              Address
            </h4>
            <AddressFields
              prefix="p-addr"
              value={address}
              onChange={setAddress}
              required
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="p-op">Operating account</Label>
              <select
                id="p-op"
                value={operatingAccountId}
                onChange={(e) => setOperatingAccountId(e.target.value)}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="">— (Set up later)</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.accountNumberMasked}
                  </option>
                ))}
              </select>
              {!operatingAccountId && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No operating account selected — payments won&apos;t be processed until one is configured in Property Settings.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-trust">Deposit trust account</Label>
              <select
                id="p-trust"
                value={depositTrustAccountId}
                onChange={(e) => setDepositTrustAccountId(e.target.value)}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="">— (Setup later)</option>
                {banks
                  .filter((b) => b.id !== operatingAccountId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.accountNumberMasked}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-reserve">Property reserve ($)</Label>
              <Input
                id="p-reserve"
                type="number"
                min={0}
                step="0.01"
                value={propertyReserve}
                onChange={(e) =>
                  setPropertyReserve(Number(e.target.value) || 0)
                }
              />
            </div>
          </div>

          <PropertyOwnershipEditor value={owners} onChange={setOwners} />

          <p className="text-xs italic text-fg-muted">
            Renters insurance minimums, custom fields, Resident Center
            settings, amenities, listing description, and photo can be edited
            from the detail page after creation.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
