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
import {
  LEASE_TYPES,
  RENT_CYCLES,
  type LeaseType,
  type RentCycle,
  type RentMethod,
} from "@/types/pm";
import { computeWarnings } from "@/lib/pm/warnings";
import { WarningInline } from "@/components/pm/WarningBadge";
import { LeaseTypeHelp } from "@/components/pm/LeaseTypeHelp";
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
  type: string;
}

// §4 — three labeled revenue rows. Base Rent → primaryRent; OPEX/Tax Recovery
// → two splitRentCharges, each against its own seeded income account.
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
  const [rentMethod, setRentMethod] = React.useState<RentMethod>("Fixed");
  const [rentRows, setRentRows] = React.useState<RentRow[]>(defaultRentRows());
  const [rentMemo, setRentMemo] = React.useState("");
  const [securityDeposit, setSecurityDeposit] = React.useState("0");
  const [scheduleRows, setScheduleRows] = React.useState<ScheduleRow[]>([]);
  const [proportionateSharePct, setProportionateSharePct] = React.useState("");
  const [salesTaxRatePct, setSalesTaxRatePct] = React.useState("");
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
    setRentMethod("Fixed");
    setRentRows(defaultRentRows());
    setRentMemo("");
    setSecurityDeposit("0");
    setScheduleRows([]);
    setProportionateSharePct("");
    setSalesTaxRatePct("");
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
      const all = (a as {
        id: string;
        name: string;
        type: string;
        active?: boolean;
        isGroup?: boolean;
      }[])
        .filter((row) => row.active !== false && !row.isGroup)
        .map((row) => ({ id: row.id, name: row.name, type: row.type }));
      setAccounts(all);
      // §4 — pre-select each row's seeded income account when present.
      const income = all.filter((x) => x.type === "Income");
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
  }, [open]);

  function updateRow(key: RentRowKey, patch: Partial<RentRow>) {
    setRentRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

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
          (data as { id: string; unitId: string; sizeSqft: number | null }[]).map(
            (r) => ({
              id: r.id,
              unitId: r.unitId,
              sizeSqft: r.sizeSqft ?? null,
            }),
          ),
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

  // §3/§4 — the rent method applies to all three revenue rows; per-sqft rows
  // resolve against the selected unit's sizeSqft.
  const selectedUnitSqft = units.find((u) => u.id === unitId)?.sizeSqft ?? null;
  const incomeAccounts = accounts.filter((a) => a.type === "Income");
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
  const baseRow = rentRows.find((r) => r.key === "base")!;

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
    // §3/§4 — price-per-sqft needs a positive Base Rent rate and a unit that
    // has a sizeSqft (Base Rent maps to the required primaryRent).
    if (rentMethod === "RatePerSqft") {
      if (!(Number(baseRow.rate) > 0)) {
        toast({
          title: "Enter a Base Rent price-per-sq-ft rate above 0",
          variant: "error",
        });
        return;
      }
      if (!(selectedUnitSqft && selectedUnitSqft > 0)) {
        toast({
          title: "Pick a unit with a square footage to use price per sq ft",
          variant: "error",
        });
        return;
      }
    }
    const cleanTenants = tenants.filter((t) => t.firstName && t.lastName);
    // §4 — OPEX/Tax Recovery → splitRentCharges (only positive-amount rows).
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
    const payload = {
      propertyId,
      unitId,
      leaseType,
      startDate,
      endDate: leaseType === "At-will" ? null : endDate || null,
      rentCycle,
      primaryRent: {
        // §3 — the server derives the cents amount for RatePerSqft from the
        // rate × unit sizeSqft; send 0 here.
        amount: rentMethod === "RatePerSqft" ? 0 : Number(baseRow.amount) || 0,
        accountId: baseRow.accountId,
        rentMethod,
        ratePerSqft:
          rentMethod === "RatePerSqft" ? Number(baseRow.rate) || 0 : undefined,
        nextDueDate: startDate,
        memo: rentMemo || undefined,
      },
      splitRentCharges,
      securityDeposit: Number(securityDeposit) || 0,
      rentSchedule: scheduleRowsToPayload(scheduleRows),
      proportionateSharePct:
        proportionateSharePct.trim() === ""
          ? undefined
          : Number(proportionateSharePct) || 0,
      salesTaxRatePct:
        salesTaxRatePct.trim() === "" ? undefined : Number(salesTaxRatePct) || 0,
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
                <div className="col-span-3 text-sm">
                  {r.label}
                  {r.key === "base" && (
                    <span className="text-muted-foreground"> *</span>
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
                    {incomeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {rentMethod === "RatePerSqft"
                  ? selectedUnitSqft && selectedUnitSqft > 0
                    ? `Rates × ${selectedUnitSqft} sq ft`
                    : "Select a unit with a square footage to use price per sq ft."
                  : ""}
              </span>
              <span className="text-sm font-medium text-foreground">
                Total: {formatMoney(Math.round(totalMonthlyDollars * 100))} / mo
              </span>
            </div>
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

        {/* Commercial rent-escalation schedule (the "Lease Summary") */}
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">
            Lease term schedule (past &amp; future) — optional
          </h3>
          <p className="text-xs text-muted-foreground">
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
            incomeAccounts={incomeAccounts}
            defaultSizeSqft={selectedUnitSqft}
            salesTaxRatePct={Number(salesTaxRatePct) || null}
          />
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
              primaryRent: { accountId: baseRow.accountId },
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
