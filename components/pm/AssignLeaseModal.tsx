// Streamlined "assign tenant to property" dialog. Creates an Active lease via
// POST /api/pm/leases binding an EXISTING tenant to a property + unit. Reused
// from two places:
//   • tenant detail page  — tenant is preset; user picks property → unit.
//   • property detail page — property (and optionally unit) is preset; user
//     picks an existing tenant via TenantPicker.
// Mirrors DraftLeaseFormModal's property→unit dependent dropdowns and the
// income-account dropdown, but defaults to At-will (no end date) and start =
// today so the lease is Active immediately and the link shows everywhere.
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
import {
  LEASE_TYPES,
  RENT_CYCLES,
  type LeaseType,
  type RentCycle,
  type RentMethod,
  type TenantType,
} from "@/types/pm";
import { TenantPicker, type TenantOption } from "@/components/pm/TenantPicker";
import { LeaseTypeHelp } from "@/components/pm/LeaseTypeHelp";
import { tenantDisplayName } from "@/lib/pm/tenantName";
import { formatMoney } from "@/lib/pm/currency";
import {
  LeaseTermScheduleEditor,
  scheduleRowsToPayload,
  type ScheduleRow,
} from "@/components/pm/LeaseTermScheduleEditor";

interface PropertyOption {
  id: string;
  propertyName: string;
}
interface UnitOption {
  id: string;
  unitId: string;
  sizeSqft: number | null;
}
interface AccountOption {
  id: string;
  name: string;
}

// §4 — rent is captured as three labeled revenue rows. Base Rent maps to the
// lease's `primaryRent`; OPEX/Tax Recovery map to two `splitRentCharges`, each
// against its own seeded income account. `defaultAccountName` matches the 0B
// seed so the right account is pre-selected when present.
type RentRowKey = "base" | "opex" | "tax";
interface RentRow {
  key: RentRowKey;
  label: string;
  defaultAccountName: string;
  amount: string; // dollars — Fixed method
  rate: string; // dollars / sq ft / mo — RatePerSqft method
  accountId: string;
}
const RENT_ROW_DEFS: {
  key: RentRowKey;
  label: string;
  defaultAccountName: string;
}[] = [
  { key: "base", label: "Base Rent", defaultAccountName: "Base Rent" },
  { key: "opex", label: "OPEX Recovery", defaultAccountName: "OPEX Recoveries" },
  { key: "tax", label: "Tax Recovery", defaultAccountName: "Tax Recoveries" },
];
function defaultRentRows(): RentRow[] {
  return RENT_ROW_DEFS.map((d) => ({
    ...d,
    amount: "0",
    rate: "0",
    accountId: "",
  }));
}

export interface PresetTenant {
  id: string;
  tenantType?: TenantType;
  firstName: string;
  lastName: string;
  companyName?: string;
  /** Preferred label (company name for Company tenants); falls back to
   *  first/last when absent. */
  displayName?: string;
  email?: string;
}

interface AssignLeaseModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (leaseId: string) => void | Promise<void>;
  /** Tenant-page launch: tenant locked, user picks property → unit. */
  presetTenant?: PresetTenant;
  /** Property-page launch: property locked, user picks unit + existing tenant. */
  presetPropertyId?: string;
  /** Unit-row launch: property + unit locked, user picks existing tenant. */
  presetUnitId?: string;
}

function todayIso(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function AssignLeaseModal({
  open,
  onClose,
  onSaved,
  presetTenant,
  presetPropertyId,
  presetUnitId,
}: AssignLeaseModalProps) {
  const { toast } = useToast();
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [units, setUnits] = React.useState<UnitOption[]>([]);
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [propertyId, setPropertyId] = React.useState("");
  const [unitId, setUnitId] = React.useState("");
  const [tenant, setTenant] = React.useState<TenantOption | null>(null);
  const [leaseType, setLeaseType] = React.useState<LeaseType>("At-will");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [rentCycle, setRentCycle] = React.useState<RentCycle>("Monthly");
  const [rentMethod, setRentMethod] = React.useState<RentMethod>("Fixed");
  const [rentRows, setRentRows] = React.useState<RentRow[]>(defaultRentRows());
  const [scheduleRows, setScheduleRows] = React.useState<ScheduleRow[]>([]);
  const [proportionateSharePct, setProportionateSharePct] = React.useState("");
  const [salesTaxRatePct, setSalesTaxRatePct] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  function updateRow(key: RentRowKey, patch: Partial<RentRow>) {
    setRentRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  // Reset form + load reference data each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setPropertyId(presetPropertyId ?? "");
    setUnitId(presetUnitId ?? "");
    setTenant(null);
    setLeaseType("At-will");
    setStartDate(todayIso());
    setEndDate("");
    setRentCycle("Monthly");
    setRentMethod("Fixed");
    setRentRows(defaultRentRows());
    setScheduleRows([]);
    setProportionateSharePct("");
    setSalesTaxRatePct("");

    let cancelled = false;
    Promise.all([
      fetch("/api/pm/properties").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/pm/chart-of-accounts").then((r) => (r.ok ? r.json() : [])),
    ]).then(([p, a]) => {
      if (cancelled) return;
      setProperties(
        (p as { id: string; propertyName: string }[]).map((row) => ({
          id: row.id,
          propertyName: row.propertyName,
        })),
      );
      const income = (a as {
        id: string;
        name: string;
        type: string;
        active?: boolean;
        isGroup?: boolean;
      }[])
        .filter(
          (row) =>
            row.active !== false && row.type === "Income" && !row.isGroup,
        )
        .map((row) => ({ id: row.id, name: row.name }));
      setAccounts(income);
      // §4 — pre-select each row's seeded income account when it exists.
      setRentRows((prev) =>
        prev.map((r) => {
          const match = income.find((x) => x.name === r.defaultAccountName);
          return match ? { ...r, accountId: match.id } : r;
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, presetPropertyId, presetUnitId]);

  // Fetch units whenever the (possibly preset) property changes.
  React.useEffect(() => {
    if (!open || !propertyId) {
      setUnits([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/pm/units?propertyId=${propertyId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: { id: string; unitId: string; sizeSqft: number | null }[]) => {
        if (cancelled) return;
        setUnits(
          data.map((r) => ({
            id: r.id,
            unitId: r.unitId,
            sizeSqft: r.sizeSqft ?? null,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, propertyId]);

  const tenantId = presetTenant?.id ?? tenant?.id ?? "";
  const noUnits = Boolean(propertyId) && units.length === 0;
  const incomeMissing = accounts.length === 0;

  // §3/§4 — the rent method applies to all three revenue rows; per-sqft rows
  // resolve against the selected unit's sizeSqft.
  const selectedUnitSqft =
    units.find((u) => u.id === unitId)?.sizeSqft ?? null;
  const rowMonthlyDollars = React.useCallback(
    (r: RentRow): number => {
      if (rentMethod === "RatePerSqft") {
        const rate = Number(r.rate) || 0;
        return selectedUnitSqft && rate > 0 ? rate * selectedUnitSqft : 0;
      }
      return Number(r.amount) || 0;
    },
    [rentMethod, selectedUnitSqft],
  );
  const totalMonthlyDollars = rentRows.reduce(
    (s, r) => s + rowMonthlyDollars(r),
    0,
  );

  // Base Rent (primaryRent) is required and, under per-sqft, needs a positive
  // rate on a unit that has a square footage. OPEX/Tax rows are optional.
  const baseRow = rentRows.find((r) => r.key === "base")!;
  const perSqftBlocked =
    rentMethod === "RatePerSqft" &&
    (!(selectedUnitSqft && selectedUnitSqft > 0) ||
      !(Number(baseRow.rate) > 0));
  // An account is required for Base Rent always, and for any recovery row that
  // carries a positive amount.
  const accountsOk = rentRows.every(
    (r) =>
      !(r.key === "base" || rowMonthlyDollars(r) > 0) || Boolean(r.accountId),
  );

  const canSubmit =
    Boolean(propertyId) &&
    Boolean(unitId) &&
    Boolean(tenantId) &&
    Boolean(startDate) &&
    accountsOk &&
    (leaseType === "At-will" || Boolean(endDate)) &&
    !perSqftBlocked &&
    !saving;

  async function save() {
    const ref = presetTenant
      ? {
          tenantId: presetTenant.id,
          tenantType: presetTenant.tenantType ?? "Individual",
          firstName: presetTenant.firstName,
          lastName: presetTenant.lastName,
          companyName: presetTenant.companyName || undefined,
          email: presetTenant.email || undefined,
          isCosigner: false,
        }
      : tenant
        ? {
            tenantId: tenant.id,
            tenantType: tenant.tenantType,
            firstName: tenant.firstName,
            lastName: tenant.lastName,
            companyName: tenant.companyName || undefined,
            email: tenant.email || undefined,
            isCosigner: false,
          }
        : null;
    if (!ref || !canSubmit) return;

    // §4 — Base Rent → primaryRent; OPEX/Tax Recovery → splitRentCharges (only
    // the rows with a positive resolved amount). For RatePerSqft the server
    // derives the base cents from rate × sizeSqft; the recovery splits send the
    // already-resolved dollar amount (the route converts with toCents).
    const base = rentRows.find((r) => r.key === "base")!;
    const splitRentCharges = rentRows
      .filter((r) => r.key !== "base")
      .map((r) => ({ row: r, dollars: rowMonthlyDollars(r) }))
      .filter(({ row, dollars }) => dollars > 0 && Boolean(row.accountId))
      .map(({ row, dollars }) => ({
        accountId: row.accountId,
        amount: dollars,
        memo: row.label,
      }));

    setSaving(true);
    const res = await fetch("/api/pm/leases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId,
        unitId,
        leaseType,
        startDate,
        endDate: leaseType === "At-will" ? null : endDate || null,
        rentCycle,
        primaryRent: {
          amount: rentMethod === "RatePerSqft" ? 0 : Number(base.amount) || 0,
          accountId: base.accountId,
          rentMethod,
          ratePerSqft:
            rentMethod === "RatePerSqft" ? Number(base.rate) || 0 : undefined,
          nextDueDate: startDate,
        },
        splitRentCharges,
        securityDepositReceived: 0,
        tenants: [ref],
        rentSchedule: scheduleRowsToPayload(scheduleRows),
        proportionateSharePct:
          proportionateSharePct.trim() === ""
            ? undefined
            : Number(proportionateSharePct) || 0,
        salesTaxRatePct:
          salesTaxRatePct.trim() === ""
            ? undefined
            : Number(salesTaxRatePct) || 0,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Assignment failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    const data = (await res.json()) as { id: string };
    toast({ title: "Tenant assigned", variant: "success" });
    onClose();
    await onSaved(data.id);
  }

  const presetPropertyName =
    properties.find((p) => p.id === propertyId)?.propertyName ??
    "Selected property";
  const presetUnitName =
    units.find((u) => u.id === unitId)?.unitId ?? "Selected unit";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title="Assign tenant to property" onClose={onClose} />
        <div className="grid grid-cols-2 gap-3">
          {/* Tenant */}
          <div className="col-span-2">
            {presetTenant ? (
              <div>
                <Label>Tenant</Label>
                <div className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg">
                  {presetTenant.displayName || tenantDisplayName(presetTenant)}
                  {presetTenant.email ? (
                    <span className="text-fg-muted">
                      {" "}
                      — {presetTenant.email}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <TenantPicker value={tenant?.id ?? ""} onChange={setTenant} />
            )}
          </div>

          {/* Property */}
          <div>
            <Label>Property</Label>
            {presetPropertyId ? (
              <div className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg">
                {presetPropertyName}
              </div>
            ) : (
              <select
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setUnitId("");
                }}
              >
                <option value="">— select —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.propertyName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Unit */}
          <div>
            <Label>Unit</Label>
            {presetUnitId ? (
              <div className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg">
                {presetUnitName}
              </div>
            ) : (
              <select
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                disabled={!propertyId}
              >
                <option value="">— select —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unitId}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Lease type */}
          <div>
            <Label>
              Lease type
              <LeaseTypeHelp />
            </Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={leaseType}
              onChange={(e) => setLeaseType(e.target.value as LeaseType)}
            >
              {LEASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Rent cycle */}
          <div>
            <Label>Rent cycle</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={rentCycle}
              onChange={(e) => setRentCycle(e.target.value as RentCycle)}
            >
              {RENT_CYCLES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Start date */}
          <div>
            <Label>Start date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {/* End date */}
          <div>
            <Label>
              End date {leaseType === "At-will" && "(N/A — At-will)"}
            </Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={leaseType === "At-will"}
            />
          </div>

          {/* Rent method (§3 — Fixed amount or rate × sqft; applies to all
              three revenue rows below) */}
          <div>
            <Label>Rent method</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={rentMethod}
              onChange={(e) => setRentMethod(e.target.value as RentMethod)}
            >
              <option value="Fixed">Fixed amount</option>
              <option value="RatePerSqft">Price per sq ft</option>
            </select>
          </div>
          <div aria-hidden />

          {/* §4 — three labeled revenue rows: Base Rent / OPEX Recovery / Tax
              Recovery, each against its own income account. */}
          <div className="col-span-2 space-y-2">
            <Label>
              Revenue —{" "}
              {rentMethod === "RatePerSqft" ? "$ / sq ft / mo" : "$ / mo"} per
              category
            </Label>
            {rentRows.map((r) => (
              <div
                key={r.key}
                className="grid grid-cols-12 items-center gap-2"
              >
                <div className="col-span-3 text-sm text-fg">
                  {r.label}
                  {r.key === "base" && (
                    <span className="text-fg-muted"> *</span>
                  )}
                </div>
                <div className="col-span-4">
                  {rentMethod === "Fixed" ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.amount}
                      onChange={(e) =>
                        updateRow(r.key, { amount: e.target.value })
                      }
                    />
                  ) : (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.rate}
                      onChange={(e) =>
                        updateRow(r.key, { rate: e.target.value })
                      }
                    />
                  )}
                </div>
                <div className="col-span-5">
                  <select
                    className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                    value={r.accountId}
                    onChange={(e) =>
                      updateRow(r.key, { accountId: e.target.value })
                    }
                  >
                    <option value="">— income account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs">
              <span className="text-fg-muted">
                {rentMethod === "RatePerSqft"
                  ? selectedUnitSqft && selectedUnitSqft > 0
                    ? `Rates × ${selectedUnitSqft} sq ft`
                    : "Select a unit with a square footage to use price per sq ft."
                  : ""}
              </span>
              <span className="text-sm font-medium text-fg">
                Total: {formatMoney(Math.round(totalMonthlyDollars * 100))} / mo
              </span>
            </div>
          </div>

          {/* Commercial rent-escalation schedule (the "Lease Summary") */}
          <div className="col-span-2 space-y-2 border-t border-border pt-3">
            <Label>Lease term schedule (past &amp; future) — optional</Label>
            <p className="text-xs text-fg-muted">
              Record an escalating rent across dated periods plus renewal options.
              When set, the active term period drives rent posting.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Proportionate share %</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 33"
                  value={proportionateSharePct}
                  onChange={(e) => setProportionateSharePct(e.target.value)}
                />
              </div>
              <div>
                <Label>GST/QST rate % (summary only)</Label>
                <Input
                  type="number"
                  step="0.001"
                  placeholder="e.g. 14.975"
                  value={salesTaxRatePct}
                  onChange={(e) => setSalesTaxRatePct(e.target.value)}
                />
              </div>
            </div>
            <LeaseTermScheduleEditor
              rows={scheduleRows}
              onRowsChange={setScheduleRows}
              incomeAccounts={accounts}
              defaultSizeSqft={selectedUnitSqft}
              salesTaxRatePct={Number(salesTaxRatePct) || null}
            />
          </div>
        </div>

        {noUnits && (
          <p className="mt-3 text-sm text-amber-600">
            This property has no units yet — add a unit before assigning a
            tenant.
          </p>
        )}
        {incomeMissing && (
          <p className="mt-3 text-sm text-amber-600">
            No income account found — add one under Accounting → Chart of
            accounts.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSubmit}>
            {saving ? "Saving…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AssignLeaseModal;
