// /properties/accounting/budgets/[id] — Budget detail with Income /
// Expenses sub-tabs (PDR §3.26a). Each tab is a 12-month editable grid
// debounced through PATCH.
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { fromCents } from "@/lib/pm/currency";
import { BudgetGridEditor } from "@/components/pm/BudgetGridEditor";
import type { BudgetLineCategory, FiscalMonth } from "@/types/pm";

interface BudgetDetail {
  id: string;
  scopeType: "Property" | "Company";
  scopeId: string;
  name: string;
  fiscalYear: number;
  fiscalYearStart: FiscalMonth;
  startDate: string;
  endDate: string;
  active: boolean;
  totalIncomeCents: number;
  totalExpensesCents: number;
  lines: Array<{
    id?: string;
    accountId: string;
    category: BudgetLineCategory;
    monthlyAmounts: number[];
    fyTotalCents: number;
  }>;
}

interface ChartOfAccountOption {
  id: string;
  name: string;
  type: string;
}

export default function BudgetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const budgetId = params?.id ?? "";

  const [budget, setBudget] = React.useState<BudgetDetail | null>(null);
  const [accounts, setAccounts] = React.useState<ChartOfAccountOption[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    if (!budgetId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/pm/budgets/${budgetId}`);
      if (r.ok) {
        setBudget((await r.json()) as BudgetDetail);
      } else if (r.status === 404) {
        toast({ title: "Budget not found", variant: "error" });
      }
    } finally {
      // Always clear the loading flag so a fetch/parse error can't hang the
      // page on "Loading…" forever (Fix 18).
      setLoading(false);
    }
  }, [budgetId, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    fetch("/api/pm/chart-of-accounts").then(async (r) => {
      if (r.ok) setAccounts((await r.json()) as ChartOfAccountOption[]);
    });
  }, []);

  async function archive() {
    if (!budget) return;
    if (!confirm("Archive this budget? It will be hidden from the list.")) return;
    const r = await fetch(`/api/pm/budgets/${budget.id}`, { method: "DELETE" });
    if (!r.ok) {
      toast({ title: "Failed to archive", variant: "error" });
      return;
    }
    toast({ title: "Budget archived", variant: "success" });
    router.push("/properties/accounting/budgets");
  }

  if (loading || !budget) {
    return <p className="p-4 text-sm text-fg-muted">Loading…</p>;
  }

  const incomeLines = budget.lines
    .filter((l) => l.category === "Income")
    .map((l) => ({
      id: l.id,
      accountId: l.accountId,
      category: l.category,
      monthlyAmounts: l.monthlyAmounts.map((c) => fromCents(c)),
    }));
  const expenseLines = budget.lines
    .filter((l) => l.category === "Expense")
    .map((l) => ({
      id: l.id,
      accountId: l.accountId,
      category: l.category,
      monthlyAmounts: l.monthlyAmounts.map((c) => fromCents(c)),
    }));

  return (
    <div className="space-y-4">
      <Link
        href="/properties/accounting/budgets"
        className="inline-flex items-center gap-1 text-sm text-fg-muted hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to budgets
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>
            {budget.name}
            <span className="ml-2 text-sm text-fg-muted">
              · FY{budget.fiscalYear}
              {!budget.active && (
                <span className="ml-2 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] uppercase">
                  Archived
                </span>
              )}
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
            <span>
              {new Date(budget.startDate).toISOString().slice(0, 10)} →{" "}
              {new Date(budget.endDate).toISOString().slice(0, 10)}
            </span>
            <span>·</span>
            <span>
              Income: <CurrencyAmount cents={budget.totalIncomeCents} />
            </span>
            <span>
              Expenses: <CurrencyAmount cents={budget.totalExpensesCents} />
            </span>
            <span>
              Net:{" "}
              <CurrencyAmount
                cents={budget.totalIncomeCents - budget.totalExpensesCents}
              />
            </span>
            <div className="ml-auto flex gap-2">
              {budget.active && (
                <Button size="sm" variant="outline" onClick={archive}>
                  Archive
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="income">
            <TabsList>
              <TabsTrigger value="income">Income</TabsTrigger>
              <TabsTrigger value="expense">Expenses</TabsTrigger>
            </TabsList>
            <TabsContent value="income">
              <BudgetGridEditor
                budgetId={budget.id}
                fiscalYearStart={budget.fiscalYearStart}
                category="Income"
                initialLines={incomeLines}
                accounts={accounts}
                onChanged={load}
              />
            </TabsContent>
            <TabsContent value="expense">
              <BudgetGridEditor
                budgetId={budget.id}
                fiscalYearStart={budget.fiscalYearStart}
                category="Expense"
                initialLines={expenseLines}
                accounts={accounts}
                onChanged={load}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
