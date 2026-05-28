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
}

export function AddBudgetModal({
  open,
  onClose,
  onSaved,
  properties,
}: AddBudgetModalProps) {
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
    fetch("/api/pm/company-accounts").then(async (r) => {
      if (r.ok) setCompanyAccounts((await r.json()) as CompanyAccountOption[]);
    });
    fetch("/api/pm/budgets?includeArchived=1").then(async (r) => {
      if (r.ok) {
        const list = (await r.json()) as Array<{
          id: string;
          name: string;
          fiscalYear: number;
        }>;
        setExistingBudgets(list);
      }
    });
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
    }
  }, [open, thisYear]);

  async function save() {
    // Presence checks for scope, name, and copy-source moved to non-blocking
    // warnings (BUDGET_MISSING_SCOPE, BUDGET_MISSING_NAME,
    // BUDGET_MISSING_COPY_SOURCE). The API stamps them on the created row.
    setSaving(true);
    const res = await fetch("/api/pm/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to create budget",
        variant: "error",
      });
      return;
    }
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Add budget" onClose={onClose} />

        <div className="space-y-3">
          <div>
            <Label>Scope</Label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scopeType === "Property"}
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
              className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={scopeId}
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
                className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
                value={fiscalYearStart}
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
            {saving ? "Saving…" : "Create budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddBudgetModal;
