// Add budget modal (PDR §3.26, BR-AC-11). Captures the four required
// fields — scope, name, fiscal year, default-amounts — then lets the
// server seed `lines[]` from prior-FY GL or an existing budget.
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
import type {
  BudgetDefaultAmounts,
  BudgetScopeType,
  FiscalMonth,
} from "@/types/pm";
import {
  BUDGET_DEFAULT_AMOUNTS,
  FISCAL_MONTHS,
} from "@/types/pm";
import { computeWarnings } from "@/lib/pm/warnings";
import { WarningInline } from "@/components/pm/WarningBadge";

interface PropertyOption {
  id: string;
  propertyName: string;
}

interface CompanyAccountOption {
  id: string;
  name: string;
}

interface BudgetSummary {
  id: string;
  name: string;
  fiscalYear: number;
}

interface AddBudgetModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  properties: PropertyOption[];
  /** When set, modal loads the budget and renames via PATCH.
   *  Scope, fiscal year, and default-amounts are locked post-creation. */
  editingId?: string;
}

export function AddBudgetModal({
  open,
  onClose,
  onSaved,
  properties,
  editingId,
}: AddBudgetModalProps) {
  const isEdit = Boolean(editingId);
  const { toast } = useToast();
  const thisYear = new Date().getFullYear();
  const [companyAccounts, setCompanyAccounts] = React.useState<
    CompanyAccountOption[]
  >([]);
  const [existingBudgets, setExistingBudgets] = React.useState<BudgetSummary[]>(
    [],
  );

  const [scopeType, setScopeType] = React.useState<BudgetScopeType>("Property");
  const [scopeId, setScopeId] = React.useState("");
  const [name, setName] = React.useState("");
  const [fiscalYear, setFiscalYear] = React.useState<number>(thisYear + 1);
  const [fiscalYearStart, setFiscalYearStart] =
    React.useState<FiscalMonth>("January");
  const [defaultAmounts, setDefaultAmounts] =
    React.useState<BudgetDefaultAmounts>("Zero");
  const [copySourceBudgetId, setCopySourceBudgetId] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/pm/company-accounts").then(async (r) => {
      if (!r.ok || cancelled) return;
      setCompanyAccounts((await r.json()) as CompanyAccountOption[]);
    });
    fetch("/api/pm/budgets?includeArchived=1").then(async (r) => {
      if (!r.ok || cancelled) return;
      const list = (await r.json()) as Array<{
        id: string;
        name: string;
        fiscalYear: number;
      }>;
      setExistingBudgets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      setScopeType("Property");
      setScopeId("");
      setName("");
      setFiscalYear(thisYear + 1);
      setFiscalYearStart("January");
      setDefaultAmounts("Zero");
      setCopySourceBudgetId("");
      // Drop the fetched option lists so a stale catalog from a previous open
      // can't flash before the refetch resolves on the next open (ADD-012).
      setCompanyAccounts([]);
      setExistingBudgets([]);
    }
  }, [open, thisYear]);

  React.useEffect(() => {
    if (!open || !editingId) return;
    let cancelled = false;
    fetch(`/api/pm/budgets/${editingId}`).then(async (r) => {
      if (!r.ok || cancelled) return;
      const b = (await r.json()) as {
        scopeType: BudgetScopeType;
        scopeId: string;
        name: string;
        fiscalYear: number;
        fiscalYearStart: FiscalMonth;
        defaultAmounts: BudgetDefaultAmounts;
      };
      if (cancelled) return;
      setScopeType(b.scopeType);
      setScopeId(b.scopeId);
      setName(b.name);
      setFiscalYear(b.fiscalYear);
      setFiscalYearStart(b.fiscalYearStart);
      setDefaultAmounts(b.defaultAmounts);
    });
    return () => {
      cancelled = true;
    };
  }, [open, editingId]);

  async function save() {
    // Hard requirements on create (ADD-007). A budget with no scope target, or
    // a "Copy existing budget" default with no source selected, produces an
    // unusable/empty budget — block before the API call and prompt the user.
    if (!isEdit) {
      if (!scopeId) {
        toast({
          title:
            scopeType === "Property"
              ? "Pick a property for this budget"
              : "Pick a company account for this budget",
          variant: "error",
        });
        return;
      }
      if (defaultAmounts === "Copy existing budget" && !copySourceBudgetId) {
        toast({ title: "Pick a source budget to copy from", variant: "error" });
        return;
      }
    }
    setSaving(true);
    const url = isEdit ? `/api/pm/budgets/${editingId}` : "/api/pm/budgets";
    const method = isEdit ? "PATCH" : "POST";
    // Edit mode: only `name` is mutable post-creation (PATCH ignores other
    // budget metadata; scope/year/defaults are seeded once at create).
    const body = isEdit
      ? { name: name.trim() }
      : {
          scopeType,
          scopeId: scopeId || undefined,
          name: name.trim(),
          fiscalYear,
          fiscalYearStart,
          defaultAmounts,
          copySourceBudgetId:
            defaultAmounts === "Copy existing budget"
              ? copySourceBudgetId || undefined
              : undefined,
        };
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      toast({
        title:
          errBody.error ?? (isEdit ? "Failed to update budget" : "Failed to create budget"),
        variant: "error",
      });
      return;
    }
    toast({
      title: isEdit ? "Budget renamed" : "Budget created",
      variant: "success",
    });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={isEdit ? "Rename budget" : "Add budget"}
          description={
            isEdit
              ? "Scope, fiscal year, and defaults are locked once a budget is created. Line items are edited in the grid."
              : undefined
          }
          onClose={onClose}
        />

        <div className="space-y-3">
          <div>
            <Label>Scope</Label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scopeType === "Property"}
                  disabled={isEdit}
                  onChange={() => {
                    setScopeType("Property");
                    setScopeId("");
                  }}
                />
                Property
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scopeType === "Company"}
                  disabled={isEdit}
                  onChange={() => {
                    setScopeType("Company");
                    setScopeId("");
                  }}
                />
                Company
              </label>
            </div>
          </div>

          <div>
            <Label htmlFor="scope-id">
              {scopeType === "Property" ? "Property" : "Company account"}
            </Label>
            <select
              id="scope-id"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm disabled:opacity-60"
              value={scopeId}
              disabled={isEdit}
              onChange={(e) => setScopeId(e.target.value)}
            >
              <option value="">Select…</option>
              {scopeType === "Property"
                ? properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.propertyName}
                    </option>
                  ))
                : companyAccounts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
            </select>
          </div>

          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`FY${fiscalYear} operating`}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fy">Fiscal year</Label>
              <Input
                id="fy"
                type="number"
                value={fiscalYear}
                disabled={isEdit}
                onChange={(e) =>
                  setFiscalYear(Number(e.target.value) || thisYear + 1)
                }
                min={1900}
                max={2999}
              />
            </div>
            <div>
              <Label htmlFor="fy-start">FY start month</Label>
              <select
                id="fy-start"
                className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm disabled:opacity-60"
                value={fiscalYearStart}
                disabled={isEdit}
                onChange={(e) =>
                  setFiscalYearStart(e.target.value as FiscalMonth)
                }
              >
                {FISCAL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>Default amounts</Label>
            <div className="flex flex-col gap-1 text-sm">
              {BUDGET_DEFAULT_AMOUNTS.map((opt) => (
                <label key={opt} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={defaultAmounts === opt}
                    disabled={isEdit}
                    onChange={() => setDefaultAmounts(opt)}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>

          {defaultAmounts === "Copy existing budget" && (
            <div>
              <Label htmlFor="src">Source budget</Label>
              <select
                id="src"
                className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
                value={copySourceBudgetId}
                onChange={(e) => setCopySourceBudgetId(e.target.value)}
              >
                <option value="">Select…</option>
                {existingBudgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} (FY{b.fiscalYear})
                  </option>
                ))}
              </select>
            </div>
          )}

          <WarningInline
            warnings={computeWarnings(
              { scopeId, name, defaultAmounts, copySourceBudgetId },
              "Budget",
            )}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save name" : "Create budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddBudgetModal;
