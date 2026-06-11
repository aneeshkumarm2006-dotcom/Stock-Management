// Edit an existing lease in place (client email §3). Loads the lease via
// GET /api/pm/leases/:id, pre-fills lease terms + the three revenue rows
// (Base Rent / OPEX Recovery / Tax Recovery), and saves through the existing
// PATCH /api/pm/leases/:id endpoint — letting the client ADD OPEX/Tax Recovery
// to a lease that previously only had Base Rent without re-creating it.
//
// Property, unit and tenants are LOCKED (read-only) here; this dialog only edits
// the lease terms and rent. Mirrors AssignLeaseModal's revenue-row + rent-method
// handling so the two forms behave identically.
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
import { LeaseTypeHelp } from "@/components/pm/LeaseTypeHelp";
import {
  LEASE_TYPES,
  RENT_CYCLES,
  type LeaseType,
  type RentCycle,
  type RentMethod,
  type TenantType,
} from "@/types/pm";
import { tenantDisplayName } from "@/lib/pm/tenantName";
import { fromCents, formatMoney } from "@/lib/pm/currency";
import { toDateInputValueUTC } from "@/lib/utils/dateInput";

interface AccountOption {
  id: string;
  name: string;
}

// §4 — same three labeled revenue rows as the create flow. Base Rent →
// primaryRent; OPEX/Tax Recovery → splitRentCharges, each against its own
// income account. `defaultAccountName` matches the 0B seed for pre-selection.
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

interface LeaseGet {
  propertyId: string;
  unitId: string;
  tenants: Array<{
    firstName: string;
    lastName: string;
    companyName?: string;
    tenantType?: TenantType;
  }>;
  leaseType: LeaseType;
  startDate: string | null;
  endDate: string | null;
  rentCycle: RentCycle;
  primaryRent: {
    amount: number; // cents
    accountId: string;
    rentMethod: RentMethod;
    ratePerSqftCents: number;
    memo: string;
  };
  splitRentCharges: Array<{ accountId: string; amount: number; memo: string }>;
  securityDeposit: { received: number };
}

interface EditLeaseModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  leaseId: string;
}

export function EditLeaseModal({
  open,
  onClose,
  onSaved,
  leaseId,
}: EditLeaseModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [propertyName, setPropertyName] = React.useState("");
  const [unitName, setUnitName] = React.useState("");
  const [unitSqft, setUnitSqft] = React.useState<number | null>(null);
  const [tenantLabel, setTenantLabel] = React.useState("");
  const [leaseType, setLeaseType] = React.useState<LeaseType>("Fixed");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [rentCycle, setRentCycle] = React.useState<RentCycle>("Monthly");
  const [rentMethod, setRentMethod] = React.useState<RentMethod>("Fixed");
  const [rentRows, setRentRows] = React.useState<RentRow[]>(defaultRentRows());
  const [baseAccountId, setBaseAccountId] = React.useState("");
  const [deposit, setDeposit] = React.useState("0");
  const [saving, setSaving] = React.useState(false);

  function updateRow(key: RentRowKey, patch: Partial<RentRow>) {
    setRentRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  // Load the lease + reference data each time the dialog opens, then pre-fill.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/pm/leases/${leaseId}`).then((r) =>
        r.ok ? (r.json() as Promise<LeaseGet>) : null,
      ),
      fetch("/api/pm/chart-of-accounts").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/pm/properties").then((r) => (r.ok ? r.json() : [])),
    ]).then(async ([lease, acc, props]) => {
      if (cancelled || !lease) {
        if (!cancelled) {
          toast({ title: "Could not load lease", variant: "error" });
          setLoading(false);
        }
        return;
      }

      const income = (acc as {
        id: string;
        name: string;
        type: string;
        active?: boolean;
        isGroup?: boolean;
      }[])
        .filter(
          (row) => row.active !== false && row.type === "Income" && !row.isGroup,
        )
        .map((row) => ({ id: row.id, name: row.name }));

      // Resolve the (locked) property + unit names for display, and the unit's
      // square footage so per-sqft rows can be reconstructed.
      const prop = (props as { id: string; propertyName: string }[]).find(
        (p) => p.id === lease.propertyId,
      );
      let uName = "";
      let uSqft: number | null = null;
      const unitsRes = await fetch(
        `/api/pm/units?propertyId=${lease.propertyId}`,
      ).then((r) => (r.ok ? r.json() : []));
      const unit = (
        unitsRes as { id: string; unitId: string; sizeSqft: number | null }[]
      ).find((u) => u.id === lease.unitId);
      if (unit) {
        uName = unit.unitId;
        uSqft = unit.sizeSqft ?? null;
      }
      if (cancelled) return;

      setAccounts(income);
      setPropertyName(prop?.propertyName ?? "(property)");
      setUnitName(uName || "(unit)");
      setUnitSqft(uSqft);
      setTenantLabel(
        lease.tenants
          .map((t) => tenantDisplayName(t))
          .filter(Boolean)
          .join(", ") || "(tenant)",
      );
      setLeaseType(lease.leaseType);
      setStartDate(toDateInputValueUTC(lease.startDate));
      setEndDate(toDateInputValueUTC(lease.endDate));
      setRentCycle(lease.rentCycle);
      const method = lease.primaryRent.rentMethod ?? "Fixed";
      setRentMethod(method);
      setBaseAccountId(lease.primaryRent.accountId);
      setDeposit(String(fromCents(lease.securityDeposit?.received ?? 0)));

      // Pre-fill the three rows. Base from primaryRent; OPEX/Tax matched to an
      // existing split by memo (the create flow stores the label there), else by
      // the split's income-account name. Per-sqft rates are reverse-derived from
      // the resolved cents ÷ sqft so the row round-trips under either method.
      const rateFor = (cents: number): string =>
        method === "RatePerSqft" && uSqft && uSqft > 0
          ? String(fromCents(cents) / uSqft)
          : "0";
      setRentRows(
        RENT_ROW_DEFS.map((d) => {
          if (d.key === "base") {
            return {
              ...d,
              amount: String(fromCents(lease.primaryRent.amount)),
              rate: rateFor(lease.primaryRent.amount),
              accountId: lease.primaryRent.accountId,
            };
          }
          const split =
            lease.splitRentCharges.find((c) => c.memo === d.label) ??
            lease.splitRentCharges.find(
              (c) =>
                income.find((a) => a.id === c.accountId)?.name ===
                d.defaultAccountName,
            );
          const seededAccount = income.find(
            (a) => a.name === d.defaultAccountName,
          );
          return {
            ...d,
            amount: split ? String(fromCents(split.amount)) : "0",
            rate: split ? rateFor(split.amount) : "0",
            accountId: split?.accountId ?? seededAccount?.id ?? "",
          };
        }),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, leaseId, toast]);

  const rowMonthlyDollars = React.useCallback(
    (r: RentRow): number => {
      if (rentMethod === "RatePerSqft") {
        const rate = Number(r.rate) || 0;
        return unitSqft && rate > 0 ? rate * unitSqft : 0;
      }
      return Number(r.amount) || 0;
    },
    [rentMethod, unitSqft],
  );
  const totalMonthlyDollars = rentRows.reduce(
    (s, r) => s + rowMonthlyDollars(r),
    0,
  );

  const baseRow = rentRows.find((r) => r.key === "base")!;
  const perSqftBlocked =
    rentMethod === "RatePerSqft" &&
    (!(unitSqft && unitSqft > 0) || !(Number(baseRow.rate) > 0));
  const accountsOk = rentRows.every(
    (r) =>
      !(r.key === "base" || rowMonthlyDollars(r) > 0) || Boolean(r.accountId),
  );

  const canSubmit =
    !loading &&
    Boolean(startDate) &&
    accountsOk &&
    (leaseType === "At-will" || Boolean(endDate)) &&
    !perSqftBlocked &&
    !saving;

  async function save() {
    if (!canSubmit) return;
    const base = rentRows.find((r) => r.key === "base")!;
    // §4 — OPEX/Tax → splitRentCharges (rows with a positive resolved amount and
    // an account). Sent as dollars; the route converts with toCents.
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
    const res = await fetch(`/api/pm/leases/${leaseId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leaseType,
        startDate,
        endDate: leaseType === "At-will" ? null : endDate || null,
        rentCycle,
        primaryRent: {
          amount: rentMethod === "RatePerSqft" ? 0 : Number(base.amount) || 0,
          accountId: base.accountId || baseAccountId,
          rentMethod,
          ratePerSqft:
            rentMethod === "RatePerSqft" ? Number(base.rate) || 0 : undefined,
          nextDueDate: startDate,
        },
        splitRentCharges,
        securityDepositReceived: Number(deposit) || 0,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Save failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    toast({ title: "Lease updated", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title="Edit lease" onClose={onClose} />
        {loading ? (
          <p className="py-8 text-center text-sm text-fg-muted">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* Locked context */}
            <div>
              <Label>Tenant</Label>
              <div className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg">
                {tenantLabel}
              </div>
            </div>
            <div>
              <Label>Property / Unit</Label>
              <div className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg">
                {propertyName} · {unitName}
              </div>
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
              <Label>End date {leaseType === "At-will" && "(N/A — At-will)"}</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={leaseType === "At-will"}
              />
            </div>

            {/* Rent method */}
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

            {/* Security deposit */}
            <div>
              <Label>Security deposit received</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
              />
            </div>

            {/* §4 — three labeled revenue rows */}
            <div className="col-span-2 space-y-2">
              <Label>
                Revenue —{" "}
                {rentMethod === "RatePerSqft" ? "$ / sq ft / mo" : "$ / mo"} per
                category
              </Label>
              {rentRows.map((r) => (
                <div key={r.key} className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-3 text-sm text-fg">
                    {r.label}
                    {r.key === "base" && <span className="text-fg-muted"> *</span>}
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
                    ? unitSqft && unitSqft > 0
                      ? `Rates × ${unitSqft} sq ft`
                      : "This unit has no square footage — switch to a fixed amount."
                    : ""}
                </span>
                <span className="text-sm font-medium text-fg">
                  Total: {formatMoney(Math.round(totalMonthlyDollars * 100))} / mo
                </span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSubmit}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EditLeaseModal;
