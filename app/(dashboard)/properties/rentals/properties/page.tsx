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
import { useCompanyAccounts } from "@/components/pm/ScopePicker";
import type {
  PmCurrency,
  PropertyClass,
  PropertySubType,
  ResidentialSubType,
  CommercialSubType,
} from "@/types/pm";
import { computeWarnings, type PmWarning } from "@/lib/pm/warnings";
import { WarningInline, WarningBadge } from "@/components/pm/WarningBadge";
import { normalizeCountry, compareCountryGroups } from "@/lib/pm/country";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { fromCents } from "@/lib/pm/currency";
import {
  computeMarketValue,
  glIncomeExpenseCentsByProperty,
  trailing12moRange,
  type MatrixLike,
} from "@/lib/pm/valuation";

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
    country?: string;
  } | null;
  /** Native booking currency; null = inherit the org default. */
  currency: PmCurrency | null;
  propertyManagerUserId: string | null;
  /** Parent legal entity; null = unassigned. */
  companyAccountId: string | null;
  companyName: string | null;
  ownerCount: number;
  owners: Array<{
    rentalOwnerId: string;
    ownershipPct: number;
    displayName: string;
  }>;
  active: boolean;
  propertyReserve: number;
  valuationAnnualIncomeOverride: number | null;
  valuationAnnualExpenseOverride: number | null;
  valuationCapRatePct: number | null;
  operatingAccountId: string | null;
  warnings: PmWarning[];
}

type PropertyGroupBy = "none" | "owner" | "country" | "company";

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
  const [groupBy, setGroupBy] = React.useState<PropertyGroupBy>("none");
  const [modalOpen, setModalOpen] = React.useState(false);
  // Trailing-12-month GL income/expense per property (cents), for the Market
  // value column. Fetched once; combined with each row's overrides + cap rate.
  const [glByProperty, setGlByProperty] = React.useState<
    Map<string, { incomeCents: number; expenseCents: number }>
  >(new Map());

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

  // GL income/expense per property for the Market value column. Independent of
  // the row list (the matrix is keyed by property id), so fetch once.
  React.useEffect(() => {
    let cancelled = false;
    const { from, to } = trailing12moRange();
    fetch(`/api/pm/financials/matrix?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MatrixLike | null) => {
        if (cancelled || !data) return;
        setGlByProperty(glIncomeExpenseCentsByProperty(data));
      })
      .catch(() => {
        /* Market value column falls back to ledger 0 if the matrix is absent. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const marketValueFor = React.useCallback(
    (p: PropertyRow): number | null => {
      const gl = glByProperty.get(p.id) ?? { incomeCents: 0, expenseCents: 0 };
      return computeMarketValue({
        incomeOverride: p.valuationAnnualIncomeOverride,
        expenseOverride: p.valuationAnnualExpenseOverride,
        capRatePct: p.valuationCapRatePct,
        glIncome: fromCents(gl.incomeCents),
        glExpense: fromCents(gl.expenseCents),
      }).marketValue;
    },
    [glByProperty],
  );

  const filtered = React.useMemo(() => {
    if (filterActive === "active") return rows.filter((r) => r.active);
    if (filterActive === "inactive") return rows.filter((r) => !r.active);
    return rows;
  }, [rows, filterActive]);

  // Group the visible rows by owner entity, country, or parent company. "none"
  // is a single unlabeled group. A property with multiple owners appears under
  // each owner; company is 1:1, so it doesn't fan out.
  const groups = React.useMemo<
    Array<{ key: string; label: string; rows: PropertyRow[] }>
  >(() => {
    if (groupBy === "none") {
      return [{ key: "all", label: "", rows: filtered }];
    }
    if (groupBy === "company") {
      const m = new Map<string, { label: string; rows: PropertyRow[] }>();
      for (const p of filtered) {
        const key = p.companyAccountId ?? "__unassigned";
        const g = m.get(key) ?? {
          label: p.companyName ?? "Unassigned",
          rows: [],
        };
        g.rows.push(p);
        m.set(key, g);
      }
      return Array.from(m.entries())
        .map(([key, v]) => ({ key, label: v.label, rows: v.rows }))
        .sort((a, b) => {
          // Unassigned pins last, matching the Unowned bucket below.
          if (a.key === "__unassigned") return 1;
          if (b.key === "__unassigned") return -1;
          return a.label.localeCompare(b.label);
        });
    }
    if (groupBy === "country") {
      const m = new Map<string, PropertyRow[]>();
      for (const p of filtered) {
        const c = normalizeCountry(p.address?.country);
        const list = m.get(c) ?? [];
        list.push(p);
        m.set(c, list);
      }
      return Array.from(m.entries())
        .map(([label, groupRows]) => ({ key: label, label, rows: groupRows }))
        .sort((a, b) => compareCountryGroups(a.label, b.label));
    }
    // owner
    const m = new Map<string, { label: string; rows: PropertyRow[] }>();
    for (const p of filtered) {
      if (!p.owners || p.owners.length === 0) {
        const g = m.get("__unowned") ?? { label: "Unowned", rows: [] };
        g.rows.push(p);
        m.set("__unowned", g);
        continue;
      }
      for (const o of p.owners) {
        const g = m.get(o.rentalOwnerId) ?? {
          label: o.displayName || "(unknown owner)",
          rows: [],
        };
        g.rows.push(p);
        m.set(o.rentalOwnerId, g);
      }
    }
    return Array.from(m.entries())
      .map(([key, v]) => ({ key, label: v.label, rows: v.rows }))
      .sort((a, b) => {
        if (a.key === "__unowned") return 1;
        if (b.key === "__unowned") return -1;
        return a.label.localeCompare(b.label);
      });
  }, [filtered, groupBy]);

  const renderPropertyRow = (p: PropertyRow) => (
    <tr
      key={p.id}
      className={"border-b border-border/40 " + (p.active ? "" : "opacity-50")}
    >
      <td className="py-2 text-fg">
        <Link
          href={`/properties/rentals/properties/${p.id}`}
          className="font-medium hover:underline"
        >
          {p.propertyName || "(Untitled)"}
        </Link>
        <WarningBadge
          entityType="Property"
          entityId={p.id}
          warnings={p.warnings}
          onIgnored={load}
          layout="inline"
          className="ml-2"
        />
      </td>
      <td className="text-fg-muted">
        {p.propertyClass}
        <span className="px-1 text-fg-muted/50">·</span>
        {p.propertySubType}
      </td>
      <td className="text-fg-muted">
        {p.owners && p.owners.length > 0
          ? p.owners.map((o) => o.displayName).join(", ")
          : p.ownerCount || "—"}
      </td>
      <td className="text-fg-muted">
        {normalizeCountry(p.address?.country)}
      </td>
      <td className="text-fg-muted">
        {p.address?.line1
          ? `${p.address.line1}, ${p.address.city ?? ""} ${p.address.state ?? ""}`
          : "—"}
      </td>
      <td className="text-right text-fg">
        {(() => {
          const mv = marketValueFor(p);
          return mv == null ? (
            <span className="text-fg-muted" title="Set a cap rate on the property's Financials tab">
              —
            </span>
          ) : (
            // Mixed list — each row converts from its OWN property's currency.
            <CurrencyAmount value={mv} currency={p.currency ?? undefined} />
          );
        })()}
      </td>
    </tr>
  );

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
            <span className="ml-2 text-xs text-fg-muted">·</span>
            <span className="text-xs text-fg-muted">Group by</span>
            {(
              [
                ["none", "None"],
                ["owner", "Owner"],
                ["company", "Company"],
                ["country", "Country"],
              ] as Array<[PropertyGroupBy, string]>
            ).map(([value, label]) => (
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
                <th>Country</th>
                <th>Address</th>
                <th className="text-right">Market value</th>
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
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    No properties match.
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.length > 0 &&
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
                            {g.rows.length} propert
                            {g.rows.length === 1 ? "y" : "ies"}
                          </span>
                        </td>
                      </tr>
                    )}
                    {g.rows.map(renderPropertyRow)}
                  </React.Fragment>
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
  const [companyAccountId, setCompanyAccountId] = React.useState("");
  const companies = useCompanyAccounts(open);
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

  // Live amber warnings while the form is being filled. The server computes
  // its own canonical set on create — this is for user feedback only.
  const localWarnings = React.useMemo(
    () =>
      computeWarnings(
        {
          propertyName,
          propertyClass,
          propertySubType,
          address,
          operatingAccountId,
          rentalOwners: owners,
        },
        "Property",
      ),
    [
      propertyName,
      propertyClass,
      propertySubType,
      address,
      operatingAccountId,
      owners,
    ],
  );

  function reset() {
    setPropertyName("");
    setPropertyClass("Residential");
    setPropertySubType("Single-Family");
    setAddress(emptyAddress);
    setOperatingAccountId("");
    setDepositTrustAccountId("");
    setPropertyReserve(0);
    setOwners([]);
    setCompanyAccountId("");
  }

  async function save() {
    // Presence / business-rule checks no longer block submission. The form
    // shows them inline (see <WarningInline> below), and the API stamps the
    // same set on the created entity so the badge persists post-creation.
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
        operatingAccountId: operatingAccountId || null,
        depositTrustAccountId: depositTrustAccountId || null,
        propertyReserve: Number.isFinite(propertyReserve) ? propertyReserve : 0,
        rentalOwners: owners,
        companyAccountId: companyAccountId || null,
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
              {/* Field-level warning lives in the unified WarningInline below
                  DialogFooter so all warnings share the same UI. */}
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

          {/* Kept visually separate from ownership: rental owners are people
              with percentages who receive distributions, whereas this is the
              single legal parent whose books the building rolls up into. */}
          <div>
            <Label htmlFor="prop-company">Company</Label>
            <select
              id="prop-company"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={companyAccountId}
              onChange={(e) => setCompanyAccountId(e.target.value)}
            >
              <option value="">— Not assigned —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-fg-muted">
              The legal entity that owns this building. Used to group mortgage
              and insurance costs.
            </p>
          </div>

          <PropertyOwnershipEditor value={owners} onChange={setOwners} />

          <p className="text-xs italic text-fg-muted">
            Renters insurance minimums, custom fields, Resident Center
            settings, amenities, listing description, and photo can be edited
            from the detail page after creation.
          </p>

          <WarningInline warnings={localWarnings} />
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
