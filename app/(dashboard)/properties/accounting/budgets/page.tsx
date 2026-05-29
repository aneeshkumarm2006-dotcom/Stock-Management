// /properties/accounting/budgets — Budget list view (PDR §3.26, BR-AC-11).
// One row per Budget, sorted FY desc. Filter chips: fiscal year, scope
// (Property|Company), include archived. "Add budget" opens the modal.
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { AddBudgetModal } from "@/components/pm/AddBudgetModal";
import { EditEntityButton } from "@/components/pm/EditEntityButton";

interface BudgetRow {
  id: string;
  scopeType: "Property" | "Company";
  scopeId: string;
  name: string;
  fiscalYear: number;
  fiscalYearStart: string;
  startDate: string;
  endDate: string;
  totalIncomeCents: number;
  totalExpensesCents: number;
  active: boolean;
  lineCount: number;
}

interface PropertyOption {
  id: string;
  propertyName: string;
}

export default function BudgetsPage() {
  const [rows, setRows] = React.useState<BudgetRow[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [fyFilter, setFyFilter] = React.useState<string>("");
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | undefined>();

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fyFilter) params.set("fiscalYear", fyFilter);
    if (includeArchived) params.set("includeArchived", "1");
    const r = await fetch(`/api/pm/budgets?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as BudgetRow[]);
    setLoading(false);
  }, [fyFilter, includeArchived]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) setProperties((await r.json()) as PropertyOption[]);
    });
  }, []);

  const propertyNameById = React.useMemo(
    () => Object.fromEntries(properties.map((p) => [p.id, p.propertyName] as const)),
    [properties],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Budgets</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="fy-filter" className="text-xs uppercase">
                Fiscal year
              </Label>
              <Input
                id="fy-filter"
                type="number"
                min={0}
                placeholder="All years"
                className="h-8 w-28 bg-bg-elevated px-2 text-sm"
                value={fyFilter}
                onChange={(e) => setFyFilter(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Include archived
            </label>
            <Button
              size="sm"
              onClick={() => {
                setEditingId(undefined);
                setModalOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add budget
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No budgets yet. Click <em>Add budget</em> to create the first FY plan.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-2">Budget</th>
                  <th>Fiscal year</th>
                  <th>Property / Company</th>
                  <th>Start</th>
                  <th>End</th>
                  <th className="text-right">Total income</th>
                  <th className="text-right">Total expenses</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-border/40">
                    <td className="py-2">
                      <Link
                        href={`/properties/accounting/budgets/${b.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {b.name}
                      </Link>
                      {!b.active && (
                        <span className="ml-2 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] uppercase text-fg-muted">
                          Archived
                        </span>
                      )}
                    </td>
                    <td>{b.fiscalYear}</td>
                    <td>
                      {b.scopeType === "Property"
                        ? propertyNameById[b.scopeId] ?? "—"
                        : "Company"}
                    </td>
                    <td>{new Date(b.startDate).toISOString().slice(0, 10)}</td>
                    <td>{new Date(b.endDate).toISOString().slice(0, 10)}</td>
                    <td className="text-right">
                      <CurrencyAmount cents={b.totalIncomeCents} />
                    </td>
                    <td className="text-right">
                      <CurrencyAmount cents={b.totalExpensesCents} />
                    </td>
                    <td className="text-right">
                      <EditEntityButton
                        onClick={() => {
                          setEditingId(b.id);
                          setModalOpen(true);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <AddBudgetModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingId(undefined);
        }}
        editingId={editingId}
        onSaved={async () => {
          setModalOpen(false);
          setEditingId(undefined);
          await load();
        }}
        properties={properties}
      />
    </div>
  );
}
