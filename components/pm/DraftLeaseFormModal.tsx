// Draft lease create modal. Captures the essentials — property/unit, dates,
// rent shape, deposit, tenants. Recurring/one-time/move-in charges and
// applicant approvals are edited on the draft detail page. BR-LL-1 enforced
// client-side: At-will hides endDate; Fixed requires it. Memo cap 100
// surfaced inline.
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
import { LEASE_TYPES, RENT_CYCLES, type LeaseType, type RentCycle } from "@/types/pm";
import { computeWarnings } from "@/lib/pm/warnings";
import { WarningInline } from "@/components/pm/WarningBadge";

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
  type: string;
}

interface TenantDraft {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
}

function newTenant(): TenantDraft {
  return {
    key: Math.random().toString(36).slice(2, 10),
    firstName: "",
    lastName: "",
    email: "",
  };
}

interface DraftLeaseFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void | Promise<void>;
}

export function DraftLeaseFormModal({
  open,
  onClose,
  onSaved,
}: DraftLeaseFormModalProps) {
  const { toast } = useToast();
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [units, setUnits] = React.useState<UnitOption[]>([]);
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [propertyId, setPropertyId] = React.useState("");
  const [unitId, setUnitId] = React.useState("");
  const [leaseType, setLeaseType] = React.useState<LeaseType>("Fixed");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [rentCycle, setRentCycle] = React.useState<RentCycle>("Monthly");
  const [rentAmount, setRentAmount] = React.useState("0");
  const [rentAccountId, setRentAccountId] = React.useState("");
  const [rentMemo, setRentMemo] = React.useState("");
  const [securityDeposit, setSecurityDeposit] = React.useState("0");
  const [tenants, setTenants] = React.useState<TenantDraft[]>([newTenant()]);
  const [residentCenterWelcome, setResidentCenterWelcome] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setPropertyId("");
    setUnitId("");
    setLeaseType("Fixed");
    setStartDate("");
    setEndDate("");
    setRentCycle("Monthly");
    setRentAmount("0");
    setRentAccountId("");
    setRentMemo("");
    setSecurityDeposit("0");
    setTenants([newTenant()]);
    setResidentCenterWelcome(false);
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
          .filter((row) => row.active !== false)
          .map((row) => ({ id: row.id, name: row.name, type: row.type })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  React.useEffect(() => {
    if (!propertyId) {
      setUnits([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/pm/units?propertyId=${propertyId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setUnits(
          (data as { id: string; unitId: string }[]).map((r) => ({
            id: r.id,
            unitId: r.unitId,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  function updateTenant(idx: number, patch: Partial<TenantDraft>) {
    setTenants((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }
  function addTenant() {
    setTenants((prev) => [...prev, newTenant()]);
  }
  function removeTenant(idx: number) {
    setTenants((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function save() {
    // Property/unit/rentAccount presence checks moved to non-blocking warnings.
    // startDate + Fixed-needs-endDate remain hard requirements — a draft lease
    // with no start date cannot be scheduled, and the Mongoose pre-validate
    // hook still enforces them. The Zod schema lets the body through; the
    // server returns a 400 only if those hard rules trip.
    // BR-LL-1: a Fixed (or any non-At-will) lease must carry an end date.
    // At-will leases intentionally have none. Guard before submit (ADD-008).
    if (leaseType !== "At-will" && !endDate) {
      toast({
        title: "End date is required for a fixed-term lease",
        variant: "error",
      });
      return;
    }
    const cleanTenants = tenants.filter((t) => t.firstName && t.lastName);
    setSaving(true);
    const payload = {
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
        memo: rentMemo || undefined,
      },
      securityDeposit: Number(securityDeposit) || 0,
      tenants: cleanTenants.map((t) => ({
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email || undefined,
        isCosigner: false,
      })),
      residentCenterWelcomeEmail: residentCenterWelcome,
    };
    const res = await fetch("/api/pm/draft-leases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Create failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    const data = (await res.json()) as { id: string };
    toast({ title: "Draft lease created" });
    onClose();
    await onSaved(data.id);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader title="New draft lease" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Property</Label>
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
          </div>
          <div>
            <Label>Unit</Label>
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
          </div>
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
          <div>
            <Label>Start date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <Label>End date {leaseType === "At-will" && "(N/A — At-will)"}</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={leaseType === "At-will"}
            />
          </div>
          <div>
            <Label>Primary rent ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={rentAmount}
              onChange={(e) => setRentAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>Rent account (CoA)</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={rentAccountId}
              onChange={(e) => setRentAccountId(e.target.value)}
            >
              <option value="">— select —</option>
              {accounts
                .filter((a) => a.type === "Income")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="col-span-2">
            <Label>Rent memo (max 100)</Label>
            <Input
              maxLength={100}
              value={rentMemo}
              onChange={(e) => setRentMemo(e.target.value)}
            />
            <div className="text-xs text-muted-foreground">
              {rentMemo.length}/100 (BR-PU-6)
            </div>
          </div>
          <div>
            <Label>Security deposit ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={securityDeposit}
              onChange={(e) => setSecurityDeposit(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <input
              id="rcwe"
              type="checkbox"
              checked={residentCenterWelcome}
              onChange={(e) => setResidentCenterWelcome(e.target.checked)}
            />
            <label htmlFor="rcwe" className="text-sm">
              Send Resident Center welcome email (default OFF — BR-LL-7)
            </label>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Tenants</h3>
            <Button variant="outline" size="sm" onClick={addTenant}>
              + Add tenant
            </Button>
          </div>
          <div className="space-y-2 mt-2">
            {tenants.map((t, idx) => (
              <div key={t.key} className="grid grid-cols-7 gap-2 items-end">
                <div className="col-span-2">
                  <Label>First name</Label>
                  <Input
                    value={t.firstName}
                    onChange={(e) =>
                      updateTenant(idx, { firstName: e.target.value })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label>Last name</Label>
                  <Input
                    value={t.lastName}
                    onChange={(e) =>
                      updateTenant(idx, { lastName: e.target.value })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={t.email}
                    onChange={(e) =>
                      updateTenant(idx, { email: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTenant(idx)}
                    disabled={tenants.length <= 1}
                  >
                    ✕
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <WarningInline
          warnings={computeWarnings(
            {
              propertyId,
              unitId,
              primaryRent: { accountId: rentAccountId },
            },
            "DraftLease",
          )}
          className="px-6"
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
