"use client";

// Bulk-assign buildings to a company.
//
// This panel IS the migration. Assigning eight properties one detail form at a
// time is not something a bookkeeper will do, and a one-off script would leave
// every future property silently unassigned with no way for her to correct a
// mistake. Doing it here means the same person who knows which building belongs
// to which entity is the one recording it, and can change it later.
//
// Two details do the real work:
//   - the `currently:` column, so a reassignment is never silent;
//   - the currency counter, which is the earliest place anyone learns that a
//     company spanning CAD and USD buildings cannot share a company-wide cost.

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export interface AssignableProperty {
  id: string;
  propertyName: string;
  currency: string | null;
  companyAccountId: string | null;
  companyName: string | null;
}

export function AssignBuildingsModal({
  open,
  company,
  properties,
  onClose,
  onSaved,
}: {
  open: boolean;
  company: { id: string; name: string; currency: string | null } | null;
  properties: AssignableProperty[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState("");
  const [unassignedOnly, setUnassignedOnly] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !company) return;
    // Pre-tick what this company already owns, so the panel reads as "the set
    // of buildings for this company" rather than "things to add".
    setSelected(
      new Set(
        properties
          .filter((p) => p.companyAccountId === company.id)
          .map((p) => p.id),
      ),
    );
    setQuery("");
    setUnassignedOnly(false);
  }, [open, company, properties]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return properties.filter((p) => {
      if (unassignedOnly && p.companyAccountId && !selected.has(p.id)) {
        return false;
      }
      if (q && !p.propertyName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [properties, query, unassignedOnly, selected]);

  const selectedRows = properties.filter((p) => selected.has(p.id));
  const currencies = Array.from(
    new Set(selectedRows.map((p) => p.currency).filter(Boolean) as string[]),
  ).sort();

  const moving = selectedRows.filter(
    (p) => p.companyAccountId && p.companyAccountId !== company?.id,
  );

  async function save() {
    if (!company) return;
    setSaving(true);

    // Assignments and un-assignments both matter: unticking a building has to
    // clear it, or the panel would be a one-way door.
    const toAssign = properties.filter(
      (p) => selected.has(p.id) && p.companyAccountId !== company.id,
    );
    const toClear = properties.filter(
      (p) => !selected.has(p.id) && p.companyAccountId === company.id,
    );

    const results = await Promise.all(
      [...toAssign, ...toClear].map(async (p) => {
        const r = await fetch(`/api/pm/properties/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyAccountId: selected.has(p.id) ? company.id : null,
          }),
        });
        return r.ok;
      }),
    );
    setSaving(false);

    const failed = results.filter((ok) => !ok).length;
    if (failed > 0) {
      toast({
        title: `${failed} building${failed === 1 ? "" : "s"} could not be updated`,
        variant: "error",
      });
    } else {
      toast({
        title: `${toAssign.length} building${toAssign.length === 1 ? "" : "s"} assigned to ${company.name}`,
      });
    }
    await onSaved();
  }

  if (!open || !company) return null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={`Assign buildings to ${company.name}`}
          onClose={onClose}
        />
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Tick the buildings this company owns. A building belongs to exactly
            one company.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search buildings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-xs"
            />
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={unassignedOnly}
                onChange={(e) => setUnassignedOnly(e.target.checked)}
              />
              Unassigned only
            </label>
          </div>

          <div className="max-h-72 overflow-auto rounded border border-border">
            <table className="w-full text-sm">
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="border-b border-border/40">
                    <td className="w-8 px-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Assign ${p.propertyName}`}
                        checked={selected.has(p.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-fg">{p.propertyName}</td>
                    <td className="px-2 py-1.5 text-xs text-fg-muted">
                      {p.currency ?? "org default"}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-fg-muted">
                      currently: {p.companyName ?? "—"}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-fg-muted">
                      No buildings match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-fg-muted">
            {selected.size} selected
            {currencies.length === 0
              ? ""
              : currencies.length === 1
                ? ` · all ${currencies[0]}`
                : ` · mixed currency (${currencies.join(", ")}) ⚠`}
          </p>

          {currencies.length > 1 ? (
            <p className="text-sm text-warning">
              Amounts are never converted between currencies, so a company-wide
              cost cannot be split across these buildings. Consider a separate
              company for the {currencies.slice(1).join(", ")} building
              {currencies.length > 2 ? "s" : ""}.
            </p>
          ) : null}

          {moving.length > 0 ? (
            <div className="space-y-0.5 text-sm text-warning">
              {moving.map((p) => (
                <p key={p.id}>
                  {p.propertyName} will move from {p.companyName} to{" "}
                  {company.name}.
                </p>
              ))}
            </div>
          ) : null}

          <p className="text-xs text-fg-muted">
            Past transactions keep the company they were posted with.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : `Assign ${selected.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
