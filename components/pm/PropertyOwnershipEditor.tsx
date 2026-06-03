"use client";

// Junction editor for Property.rentalOwners[] = [{ rentalOwnerId, ownershipPct }].
// Loads RentalOwners via /api/pm/rental-owners and enforces the BR-PU-1
// invariant (sum of ownershipPct = 100% when any owners are attached) with
// a live total chip. Submit handlers in parent forms gate on `valid`.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface OwnershipRow {
  rentalOwnerId: string;
  ownershipPct: number;
}

interface OwnerOption {
  id: string;
  displayName: string;
}

interface Props {
  value: OwnershipRow[];
  onChange: (next: OwnershipRow[]) => void;
}

export function PropertyOwnershipEditor({ value, onChange }: Props) {
  const [owners, setOwners] = React.useState<OwnerOption[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/rental-owners")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<Record<string, unknown>>) => {
        if (cancelled) return;
        setOwners(
          rows.map((r) => ({
            id: String(r.id),
            displayName: String(r.displayName ?? `${r.firstName} ${r.lastName}`),
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = value.reduce((acc, r) => acc + (Number.isFinite(r.ownershipPct) ? r.ownershipPct : 0), 0);
  // Compare with an epsilon so valid splits like 33.33/33.33/33.34 (which sum
  // to 100.00 but accumulate binary-float error) aren't rejected (EDIT-019).
  const valid = value.length === 0 || Math.abs(total - 100) < 0.01;

  function add() {
    onChange([...value, { rentalOwnerId: "", ownershipPct: 0 }]);
  }
  function update(i: number, patch: Partial<OwnershipRow>) {
    const current = value[i];
    if (!current) return;
    const next = value.slice();
    next[i] = { ...current, ...patch };
    onChange(next);
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Rental owners</Label>
        <span
          className={
            valid
              ? "rounded bg-success/10 px-2 py-0.5 text-xs font-bold text-success"
              : "rounded bg-error/10 px-2 py-0.5 text-xs font-bold text-error"
          }
          aria-live="polite"
        >
          Total: {total}%{value.length > 0 && !valid && " (must be 100%)"}
        </span>
      </div>

      {loading && <p className="text-sm text-fg-muted">Loading owners…</p>}
      {!loading && owners.length === 0 && (
        <p className="text-sm text-fg-muted">
          No rental owners yet. Create one first under Rentals → Rental owners.
        </p>
      )}

      {value.map((row, i) => (
        <div key={i} className="grid gap-2 md:grid-cols-[1fr_120px_auto] md:items-end">
          <div className="space-y-1">
            <Label htmlFor={`po-owner-${i}`}>Owner</Label>
            <select
              id={`po-owner-${i}`}
              value={row.rentalOwnerId}
              onChange={(e) => update(i, { rentalOwnerId: e.target.value })}
              className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
            >
              <option value="">Choose…</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`po-pct-${i}`}>Share %</Label>
            <Input
              id={`po-pct-${i}`}
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={Number.isFinite(row.ownershipPct) ? row.ownershipPct : 0}
              onChange={(e) =>
                update(i, {
                  ownershipPct: e.target.value === "" ? 0 : Number(e.target.value),
                })
              }
            />
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="mb-1 rounded p-2 text-fg-muted hover:bg-surface-high hover:text-error"
            aria-label="Remove owner"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add owner
      </Button>
    </div>
  );
}

export default PropertyOwnershipEditor;
