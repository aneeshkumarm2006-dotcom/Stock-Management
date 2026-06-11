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
  onChanged: () => void | Promise<void>;
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

  // EDIT-005 concurrency control:
  //  - `dirty` marks local edits not yet confirmed by the server. While dirty
  //    we refuse to clobber `lines` from incoming props (a refetch landing
  //    mid-edit must not roll the user back).
  //  - `inFlight` allows only one PATCH at a time; if more edits arrive while a
  //    flush is running we set `pending` and re-flush when it returns.
  //  - `abortRef` cancels the in-flight refetch+PATCH on unmount.
  //  - `linesRef` always holds the latest local lines for the async flush.
  const dirtyRef = React.useRef(false);
  const inFlightRef = React.useRef(false);
  const pendingRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const linesRef = React.useRef<LineDraft[]>(initialLines);
  React.useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

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

  // Adopt server-provided lines only when we have no unsaved local edits.
  // Adopting while dirty would discard the user's in-progress changes when a
  // sibling tab's onChanged() triggers a parent refetch (EDIT-005).
  React.useEffect(() => {
    if (dirtyRef.current) return;
    setLines(initialLines);
  }, [initialLines]);

  // Clear any pending debounced flush and abort an in-flight one when the
  // category changes or the component unmounts (EDIT-004). Without this a
  // stale timer/PATCH from the previous category could fire against new state.
  React.useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      abortRef.current?.abort();
    };
  }, [category]);

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
    // Any scheduled flush means there are unsaved local edits.
    dirtyRef.current = true;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      void flush();
    }, delay);
  }

  async function flush() {
    // Only one flush in flight at a time; coalesce concurrent requests into a
    // single follow-up so a double-edit can't race two PATCHes (EDIT-005).
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setSaving(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const otherCategory: BudgetLineCategory =
      category === "Income" ? "Expense" : "Income";

    try {
      // EDIT-004: the PATCH replaces the WHOLE lines[] array, but this editor
      // only owns one category. The previous code merged `initialLines` — which
      // the parent pre-filters to THIS category — so the other category was
      // always empty and got wiped. Refetch the live budget to capture the
      // current other-category lines (possibly edited in the sibling tab), then
      // merge our local lines on top.
      let otherLines: Array<{
        accountId: string;
        category: BudgetLineCategory;
        monthlyAmounts: number[];
      }> = [];
      const liveRes = await fetch(`/api/pm/budgets/${budgetId}`, {
        signal: controller.signal,
      });
      if (liveRes.ok) {
        const live = (await liveRes.json()) as {
          lines: Array<{
            accountId: string;
            category: BudgetLineCategory;
            monthlyAmounts: number[];
          }>;
        };
        otherLines = live.lines
          .filter((l) => l.category === otherCategory)
          .map((l) => ({
            accountId: l.accountId,
            category: l.category,
            // Live other-category amounts come back in cents; convert to the
            // dollar shape PATCH expects (it re-applies toCents server-side).
            monthlyAmounts: l.monthlyAmounts.map((c) => c / 100),
          }));
      }

      const localLines = linesRef.current;
      const payload = {
        lines: [
          ...localLines.map((l) => ({
            accountId: l.accountId,
            category: l.category,
            monthlyAmounts: l.monthlyAmounts,
          })),
          ...otherLines,
        ],
      };
      const res = await fetch(`/api/pm/budgets/${budgetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: body.error ?? "Failed to save budget",
          variant: "error",
        });
        return;
      }
      // Saved cleanly — local state now matches the server, so allow prop sync
      // to resume. Keep `dirty` if newer edits queued up while we were saving
      // (pendingRef), so the upcoming refetch can't clobber them.
      if (!pendingRef.current) dirtyRef.current = false;
      try {
        await onChanged();
      } catch (e) {
        toast({
          title: "Failed to refresh — " + (e as Error).message,
          variant: "error",
        });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      toast({ title: "Failed to save budget", variant: "error" });
    } finally {
      inFlightRef.current = false;
      abortRef.current = null;
      setSaving(false);
      // If edits arrived while this flush ran, run exactly one more pass.
      if (pendingRef.current) {
        pendingRef.current = false;
        void flush();
      }
    }
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
