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
} from "@/types/pm";
import { TenantPicker, type TenantOption } from "@/components/pm/TenantPicker";

interface PropertyOption {
  id: string;
  propertyName: string;
}
interface UnitOption {
  id: string;
  unitId: string;
}
interface AccountOption {
  id: string;
  name: string;
}

export interface PresetTenant {
  id: string;
  firstName: string;
  lastName: string;
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
  const [rentAmount, setRentAmount] = React.useState("0");
  const [rentAccountId, setRentAccountId] = React.useState("");
  const [saving, setSaving] = React.useState(false);

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
    setRentAmount("0");
    setRentAccountId("");

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
      setAccounts(
        (a as { id: string; name: string; type: string; active?: boolean }[])
          .filter((row) => row.active !== false && row.type === "Income")
          .map((row) => ({ id: row.id, name: row.name })),
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
      .then((data: { id: string; unitId: string }[]) => {
        if (cancelled) return;
        setUnits(data.map((r) => ({ id: r.id, unitId: r.unitId })));
      });
    return () => {
      cancelled = true;
    };
  }, [open, propertyId]);

  const tenantId = presetTenant?.id ?? tenant?.id ?? "";
  const noUnits = Boolean(propertyId) && units.length === 0;
  const incomeMissing = accounts.length === 0;

  const canSubmit =
    Boolean(propertyId) &&
    Boolean(unitId) &&
    Boolean(tenantId) &&
    Boolean(startDate) &&
    Boolean(rentAccountId) &&
    (leaseType === "At-will" || Boolean(endDate)) &&
    !saving;

  async function save() {
    const ref = presetTenant
      ? {
          tenantId: presetTenant.id,
          firstName: presetTenant.firstName,
          lastName: presetTenant.lastName,
          email: presetTenant.email || undefined,
          isCosigner: false,
        }
      : tenant
        ? {
            tenantId: tenant.id,
            firstName: tenant.firstName,
            lastName: tenant.lastName,
            email: tenant.email || undefined,
            isCosigner: false,
          }
        : null;
    if (!ref || !canSubmit) return;

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
          amount: Number(rentAmount) || 0,
          accountId: rentAccountId,
          nextDueDate: startDate,
        },
        securityDepositReceived: 0,
        tenants: [ref],
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
                  {presetTenant.firstName} {presetTenant.lastName}
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
            <Label>Lease type</Label>
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

          {/* Rent amount */}
          <div>
            <Label>Rent ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={rentAmount}
              onChange={(e) => setRentAmount(e.target.value)}
            />
          </div>

          {/* Rent account */}
          <div>
            <Label>Rent account (income)</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={rentAccountId}
              onChange={(e) => setRentAccountId(e.target.value)}
            >
              <option value="">— select —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
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
