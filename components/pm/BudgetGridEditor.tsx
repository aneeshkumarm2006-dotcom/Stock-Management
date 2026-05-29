// Budget grid editor — 12-month editable table per Income/Expense
// sub-tab (PDR §3.26a). Edits are buffered locally and a debounced
// PATCH posts the whole `lines[]` payload back. Adding a line opens
// a small inline picker; removing a line deletes locally + flushes.
//
// Amounts are entered as dollars; conversion to cents happens
// server-side via `toCents` (mirrors JournalEntry / Bill / Deposit).
"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { BudgetLineCategory, FiscalMonth } from "@/types/pm";
import { FISCAL_MONTH_INDEX } from "@/types/pm";

const MONTH_LABELS_BY_INDEX = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

interface LineDraft {
  id?: string;
  accountId: string;
  category: BudgetLineCategory;
  /** Dollars in the editor; converted to cents on save. */
  monthlyAmounts: number[];
}

interface ChartOfAccountOption {
  id: string;
  name: string;
  type: string;
}

interface BudgetGridEditorProps {
  budgetId: string;
  fiscalYearStart: FiscalMonth;
  category: BudgetLineCategory;
  initialLines: LineDraft[];
  accounts: ChartOfAccountOption[];
  onChanged: () => void;
}

/** Map the fiscal-month column index 0..11 to its calendar-month abbrev. */
function monthHeaderFor(idxFromFyStart: number, fyStart: FiscalMonth): string {
  const startCalendarMonth = FISCAL_MONTH_INDEX[fyStart]; // 1-12
  const calendar = ((startCalendarMonth - 1 + idxFromFyStart) % 12) + 1; // 1-12
  return MONTH_LABELS_BY_INDEX[calendar - 1]!;
}

function fyTotalDollars(line: LineDraft): number {
  return line.monthlyAmounts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

export function BudgetGridEditor({
  budgetId,
  fiscalYearStart,
  category,
  initialLines,
  accounts,
  onChanged,
}: BudgetGridEditorProps) {
  const { toast } = useToast();
  const [lines, setLines] = React.useState<LineDraft[]>(initialLines);
  const [showAdd, setShowAdd] = React.useState(false);
  const [newAccountId, setNewAccountId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const flushTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter accounts to the category type so the picker only shows
  // sensible options.
  const candidateAccounts = React.useMemo(
    () =>
      accounts.filter((a) => {
        if (category === "Income") return a.type === "Income";
        return a.type === "Operating Expense";
      }),
    [accounts, category],
  );

  const accountNameById = React.useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name] as const)),
    [accounts],
  );

  // Reset whenever the underlying budget reloads from server.
  React.useEffect(() => {
    setLines(initialLines);
  }, [initialLines]);

  function setCell(lineIdx: number, monthIdx: number, value: number) {
    setLines((prev) => {
      const next = prev.map((l, i) =>
        i === lineIdx
          ? {
              ...l,
              monthlyAmounts: l.monthlyAmounts.map((v, j) =>
                j === monthIdx ? value : v,
              ),
            }
          : l,
      );
      return next;
    });
    scheduleFlush();
  }

  function removeLine(lineIdx: number) {
    setLines((prev) => prev.filter((_, i) => i !== lineIdx));
    scheduleFlush(0);
  }

  function addLine() {
    if (!newAccountId) {
      toast({ title: "Pick an account", variant: "error" });
      return;
    }
    if (lines.some((l) => l.accountId === newAccountId)) {
      toast({ title: "Account already on the budget", variant: "error" });
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        accountId: newAccountId,
        category,
        monthlyAmounts: new Array(12).fill(0),
      },
    ]);
    setNewAccountId("");
    setShowAdd(false);
    scheduleFlush(0);
  }

  function scheduleFlush(delay = 600) {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      void flush();
    }, delay);
  }

  async function flush() {
    setSaving(true);
    // Merge with the OTHER category's lines so we don't drop them.
    const otherCategory: BudgetLineCategory =
      category === "Income" ? "Expense" : "Income";
    const otherLines = initialLines.filter((l) => l.category === otherCategory);
    const payload = {
      lines: [...lines, ...otherLines].map((l) => ({
        accountId: l.accountId,
        category: l.category,
        monthlyAmounts: l.monthlyAmounts,
      })),
    };
    const res = await fetch(`/api/pm/budgets/${budgetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to save budget",
        variant: "error",
      });
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
            <tr>
              <th className="py-2 text-left">Account</th>
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i} className="px-1 text-right">
                  {monthHeaderFor(i, fiscalYearStart)}
                </th>
              ))}
              <th className="px-1 text-right">FY total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="py-4 text-center text-sm text-fg-muted"
                >
                  No {category.toLowerCase()} lines yet. Click <em>Add line</em>{" "}
                  below.
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => (
                <tr key={l.accountId} className="border-b border-border/40">
                  <td className="py-1 pr-2">
                    {accountNameById[l.accountId] ?? "—"}
                  </td>
                  {l.monthlyAmounts.map((v, m) => (
                    <td key={m} className="px-0.5">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-7 w-20 bg-bg-elevated px-1 text-right text-xs"
                        value={Number.isFinite(v) ? v : 0}
                        onChange={(e) =>
                          setCell(idx, m, Number(e.target.value) || 0)
                        }
                      />
                    </td>
                  ))}
                  <td className="px-1 text-right tabular-nums">
                    ${fyTotalDollars(l).toFixed(2)}
                  </td>
                  <td className="px-1">
                    <button
                      aria-label="Remove line"
                      onClick={() => removeLine(idx)}
                      className="text-fg-muted hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        {showAdd ? (
          <>
            <select
              className="h-8 rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={newAccountId}
              onChange={(e) => setNewAccountId(e.target.value)}
            >
              <option value="">Select {category.toLowerCase()} account…</option>
              {candidateAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={addLine}>
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowAdd(false);
                setNewAccountId("");
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </Button>
        )}
        {saving && (
          <span className="text-xs text-fg-muted">Saving…</span>
        )}
      </div>
    </div>
  );
}

export default BudgetGridEditor;
