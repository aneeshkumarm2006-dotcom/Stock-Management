// /settings/pm/companies — the legal entities that own this org's buildings.
//
// An org is seeded with one company named after itself. Orgs that own several
// entities (Ramco Development Inc. and Immeubles Greene Inc. each signing their
// own mortgages and insurance) add the rest here, then assign each building to
// its owner. That assignment is what makes a company-wide cost answerable:
// "split this premium across all of Greene's buildings".
//
// Structure mirrors /properties/settings/approval-rules — Card + table + modal
// as a sibling in the same file, plain fetch in a useCallback, confirm() before
// deactivate, no client-side permission gate (the API enforces canManageOrg and
// a 403 surfaces as a toast).
"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { computeWarnings } from "@/lib/pm/warnings";
import { WarningInline } from "@/components/pm/WarningBadge";
import { AssignBuildingsModal } from "@/components/pm/AssignBuildingsModal";
import { PM_CURRENCIES } from "@/types/pm";

interface Company {
  id: string;
  name: string;
  defaultCashAccountId: string | null;
  currency: string | null;
  active: boolean;
}

interface BankOption {
  id: string;
  name: string;
}

interface PropertyRow {
  id: string;
  propertyName: string;
  currency: string | null;
  companyAccountId: string | null;
  companyName: string | null;
}

export default function CompaniesPage() {
  const { toast } = useToast();
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [properties, setProperties] = React.useState<PropertyRow[]>([]);
  const [banks, setBanks] = React.useState<BankOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Company | null>(null);
  const [assignFor, setAssignFor] = React.useState<Company | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([
      fetch("/api/pm/company-accounts"),
      fetch("/api/pm/properties"),
    ]);
    if (c.ok) setCompanies((await c.json()) as Company[]);
    if (p.ok) setProperties((await p.json()) as PropertyRow[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
    fetch("/api/pm/bank-accounts").then(async (r) => {
      if (r.ok) setBanks((await r.json()) as BankOption[]);
    });
  }, [load]);

  const bankNameById = React.useMemo(
    () => Object.fromEntries(banks.map((b) => [b.id, b.name])),
    [banks],
  );

  /**
   * Buildings + currencies per company, derived from the properties list rather
   * than fetched separately — the same source the allocation preview reads, so
   * the two can't disagree about which buildings belong where.
   */
  const statsByCompany = React.useMemo(() => {
    const out = new Map<string, { count: number; currencies: Set<string> }>();
    for (const p of properties) {
      if (!p.companyAccountId) continue;
      const s = out.get(p.companyAccountId) ?? {
        count: 0,
        currencies: new Set<string>(),
      };
      s.count += 1;
      // A property with no currency inherits the org default; showing it as
      // blank would misrepresent it as a conflict.
      if (p.currency) s.currencies.add(p.currency);
      out.set(p.companyAccountId, s);
    }
    return out;
  }, [properties]);

  const unassignedCount = properties.filter((p) => !p.companyAccountId).length;

  async function deactivate(c: Company) {
    const assigned = statsByCompany.get(c.id)?.count ?? 0;
    const msg = assigned
      ? `Deactivate ${c.name}? ${assigned} building${assigned === 1 ? " is" : "s are"} still assigned to it. It stays on past transactions but stops appearing in the Property-or-company list.`
      : `Deactivate ${c.name}? It stays on past transactions but stops appearing in the Property-or-company list.`;
    if (!confirm(msg)) return;
    const r = await fetch(`/api/pm/company-accounts/${c.id}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Could not deactivate company",
        variant: "error",
      });
      return;
    }
    toast({ title: "Company deactivated" });
    await load();
  }

  return (
    <div className="space-y-4">
      {!loading && companies.length === 1 ? (
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            <p className="text-fg">
              You have one company: {companies[0]!.name}. Add the other entities
              that own your buildings, then assign each building to the one that
              owns it.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Add company
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAssignFor(companies[0]!)}
              >
                Assign buildings
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Companies</CardTitle>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add company
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-fg-muted">
            A company is the legal entity that owns buildings and signs mortgages
            and insurance policies. Assign each building to a company so
            company-wide costs land in the right place.
          </p>

          {loading ? (
            <p className="py-4 text-sm text-fg-muted">Loading…</p>
          ) : companies.length === 0 ? (
            <p className="py-4 text-sm text-fg-muted">No companies yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-2">Name</th>
                  <th>Buildings</th>
                  <th>Currency</th>
                  <th>Default bank</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const stats = statsByCompany.get(c.id);
                  const currencies = Array.from(stats?.currencies ?? []);
                  return (
                    <tr key={c.id} className="border-b border-border/40">
                      <td className="py-2 text-fg">
                        {c.name}
                        {companies.length === 1 ? (
                          <p className="text-xs text-fg-muted">
                            Created automatically from your organization name.
                            Rename it if the legal name is different.
                          </p>
                        ) : null}
                      </td>
                      <td className="text-fg-muted">{stats?.count ?? 0}</td>
                      <td className="text-fg-muted">
                        {currencies.length > 1 ? (
                          <span
                            className="text-warning"
                            title="Amounts are never converted, so company-wide costs cannot be split across buildings that book in different currencies."
                          >
                            Mixed ({currencies.sort().join(", ")}) ⚠
                          </span>
                        ) : (
                          (c.currency ?? currencies[0] ?? "—")
                        )}
                      </td>
                      <td className="text-fg-muted">
                        {c.defaultCashAccountId
                          ? (bankNameById[c.defaultCashAccountId] ?? "—")
                          : "—"}
                      </td>
                      <td className="text-fg-muted">
                        {c.active ? "Active" : "Inactive"}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="text-xs text-fg-muted hover:text-fg"
                            onClick={() => setAssignFor(c)}
                          >
                            Assign buildings
                          </button>
                          <button
                            type="button"
                            className="text-xs text-fg-muted hover:text-fg"
                            onClick={() => {
                              setEditing(c);
                              setModalOpen(true);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            aria-label={`Deactivate ${c.name}`}
                            className="text-fg-muted hover:text-error"
                            onClick={() => void deactivate(c)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!loading && unassignedCount > 0 ? (
            <p className="mt-3 text-sm text-fg-muted">
              {unassignedCount} building{unassignedCount === 1 ? "" : "s"} not
              assigned to any company.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <CompanyModal
        open={modalOpen}
        existing={editing}
        banks={banks}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false);
          await load();
        }}
      />

      <AssignBuildingsModal
        open={Boolean(assignFor)}
        company={assignFor}
        properties={properties}
        onClose={() => setAssignFor(null)}
        onSaved={async () => {
          setAssignFor(null);
          await load();
        }}
      />
    </div>
  );
}

function CompanyModal({
  open,
  existing,
  banks,
  onClose,
  onSaved,
}: {
  open: boolean;
  existing: Company | null;
  banks: BankOption[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [defaultCashAccountId, setDefaultCashAccountId] = React.useState("");
  const [currency, setCurrency] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setDefaultCashAccountId(existing?.defaultCashAccountId ?? "");
    setCurrency(existing?.currency ?? "");
    setActive(existing?.active ?? true);
  }, [open, existing]);

  async function save() {
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      defaultCashAccountId: defaultCashAccountId || null,
      // "" means "inherit the org default" — the same convention as
      // Property.currency, and the reason this is nullable rather than defaulted.
      currency: currency || null,
    };
    if (existing) payload.active = active;

    const r = await fetch(
      existing
        ? `/api/pm/company-accounts/${existing.id}`
        : "/api/pm/company-accounts",
      {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({ title: body.error ?? "Could not save company", variant: "error" });
      return;
    }
    toast({ title: existing ? "Company saved" : "Company added" });
    await onSaved();
  }

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={existing ? "Edit company" : "Add company"}
          onClose={onClose}
        />
        <div className="space-y-3">
          <div>
            <Label htmlFor="co-name">Name</Label>
            <Input
              id="co-name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="mt-1 text-xs text-fg-muted">
              The legal name you&rsquo;d see on the mortgage or insurance policy.
            </p>
          </div>

          <div>
            <Label htmlFor="co-currency">Currency</Label>
            <select
              id="co-currency"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="">Same as organization</option>
              {PM_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-fg-muted">
              What this company&rsquo;s own costs are denominated in. Only
              buildings booking in the same currency can share a company-wide
              cost — amounts are never converted.
            </p>
          </div>

          <div>
            <Label htmlFor="co-bank">Default bank account (optional)</Label>
            <select
              id="co-bank"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={defaultCashAccountId}
              onChange={(e) => setDefaultCashAccountId(e.target.value)}
            >
              <option value="">None</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-fg-muted">
              Used as the default cash account for this company&rsquo;s own
              transactions.
            </p>
          </div>

          {existing ? (
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          ) : null}

          <WarningInline warnings={computeWarnings({ name }, "CompanyAccount")} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : existing ? "Save" : "Add company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
