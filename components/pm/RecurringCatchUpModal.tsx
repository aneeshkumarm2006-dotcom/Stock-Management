// Catch-up modal for recurring transactions.
//
// The poster advances one period per run, so a rule whose cursor has fallen
// months behind needs one cron run per missed month to catch up. This is the
// surface that posts them all at once — the answer to "can we post Jan–Jul
// without keying them in by hand?".
//
// Preview is mandatory before posting. The dry run is a pure enumeration
// server-side (planRecurringCatchUp), sharing enumeratePeriods with the apply
// path so it cannot promise something the run won't deliver. It surfaces three
// things the user must see BEFORE committing: locked periods, possible
// duplicates against manually-entered records, and the grand total.
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
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";

interface PlannedPeriod {
  ruleId: string;
  memo: string;
  type: string;
  frequency: string;
  periodDate: string;
  amountCents: number;
  /**
   * One entry per posting LINE. An allocated company amount appears as one
   * entry per building with its own cents — seeing the split before it posts
   * is the entire point of the dry run.
   */
  scopes: Array<{
    propertyId: string | null;
    propertyName: string;
    amountCents: number;
    allocatedFromCompanyId?: string | null;
    allocatedFromCompanyName?: string | null;
  }>;
  status: "will-post" | "locked" | "unsupported" | "possible-duplicate";
  note?: string;
  warnings: string[];
}

interface CatchUpPlan {
  throughDate: string;
  plan: PlannedPeriod[];
  totals: { rules: number; periods: number; cents: number; blocked: number };
}

export interface CatchUpRuleOption {
  id: string;
  label: string;
}

interface RecurringCatchUpModalProps {
  open: boolean;
  rules: CatchUpRuleOption[];
  onClose: () => void;
  onPosted: () => Promise<void> | void;
}

/** Last day of the previous month — the normal "close out what's behind" bound. */
function defaultThroughDate(): string {
  const now = new Date();
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${endOfLastMonth.getFullYear()}-${pad(endOfLastMonth.getMonth() + 1)}-${pad(endOfLastMonth.getDate())}`;
}

export function RecurringCatchUpModal({
  open,
  rules,
  onClose,
  onPosted,
}: RecurringCatchUpModalProps) {
  const { toast } = useToast();
  const [throughDate, setThroughDate] = React.useState(defaultThroughDate);
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(rules.map((r) => r.id)),
  );
  const [plan, setPlan] = React.useState<CatchUpPlan | null>(null);
  // The date the current plan was built for. Changing the date or the rule
  // selection invalidates it, so Post can never act on a stale preview.
  const [previewKey, setPreviewKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const selectionKey = React.useMemo(
    () => `${throughDate}|${Array.from(selected).sort().join(",")}`,
    [throughDate, selected],
  );
  const planIsCurrent = plan !== null && previewKey === selectionKey;

  function toggleRule(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function callRun(dryRun: boolean) {
    const res = await fetch("/api/pm/recurring-transactions/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        throughDate: new Date(throughDate).toISOString(),
        dryRun,
        // Omit when everything is selected so the server sweeps all active
        // rules rather than a snapshot that may have gone stale.
        ...(selected.size === rules.length
          ? {}
          : { ruleIds: Array.from(selected) }),
      }),
    });
    return res;
  }

  async function preview() {
    if (selected.size === 0) {
      toast({ title: "Select at least one rule", variant: "error" });
      return;
    }
    setBusy(true);
    const res = await callRun(true);
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Preview failed",
        description: err.error,
        variant: "error",
      });
      return;
    }
    const data = (await res.json()) as CatchUpPlan;
    setPlan(data);
    setPreviewKey(selectionKey);
  }

  async function post() {
    if (!plan || !planIsCurrent) return;
    const postable = plan.plan.filter(
      (p) => p.status === "will-post" || p.status === "possible-duplicate",
    );
    if (postable.length === 0) {
      toast({ title: "Nothing to post", variant: "error" });
      return;
    }
    const dupes = plan.plan.filter(
      (p) => p.status === "possible-duplicate",
    ).length;
    const totalDollars = (
      postable.reduce((s, p) => s + p.amountCents, 0) / 100
    ).toFixed(2);
    if (
      !confirm(
        `Post ${postable.length} entries totalling ${totalDollars} through ${new Date(throughDate).toLocaleDateString()}?` +
          (dupes > 0
            ? `\n\n${dupes} of these look like possible duplicates of existing records.`
            : ""),
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await callRun(false);
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Post failed", description: err.error, variant: "error" });
      return;
    }
    const data = (await res.json()) as { posted: number; skipped: number };
    toast({
      title: `Posted ${data.posted} entries`,
      description:
        data.skipped > 0 ? `${data.skipped} skipped — re-preview to see why.` : undefined,
      variant: "success",
    });
    onClose();
    await onPosted();
  }

  const rowClass = (status: PlannedPeriod["status"]) => {
    if (status === "locked" || status === "unsupported") {
      return "bg-error/10 text-error";
    }
    if (status === "possible-duplicate") return "bg-warning/10 text-warning";
    return "";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader title="Catch up recurring transactions" onClose={onClose} />
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            Posts every missed period for the selected rules, up to and
            including the date below. Preview first — posting into a closed
            accounting period requires the Financial Administrator role.
          </p>

          <div className="space-y-1">
            <Label htmlFor="catchup-through">Post all periods through</Label>
            <Input
              id="catchup-through"
              type="date"
              className="max-w-xs"
              value={throughDate}
              onChange={(e) => setThroughDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-widest text-fg-muted">
                Rules ({selected.size}/{rules.length})
              </h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs text-fg-muted underline hover:text-fg"
                  onClick={() => setSelected(new Set(rules.map((r) => r.id)))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-xs text-fg-muted underline hover:text-fg"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border p-2">
              {rules.map((r) => (
                <label
                  key={r.id}
                  className="flex items-center gap-2 text-sm text-fg"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleRule(r.id)}
                  />
                  {r.label}
                </label>
              ))}
              {rules.length === 0 && (
                <p className="text-sm text-fg-muted">No active rules.</p>
              )}
            </div>
          </div>

          {plan && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-fg-muted">
                  {plan.totals.periods}{" "}
                  {plan.totals.periods === 1 ? "period" : "periods"} across{" "}
                  {plan.totals.rules}{" "}
                  {plan.totals.rules === 1 ? "rule" : "rules"}
                </span>
                <span className="text-fg">
                  Total{" "}
                  {/* Native, not display-converted — see the amount cells. */}
                  <CurrencyAmount cents={plan.totals.cents} convert={false} />
                </span>
                {plan.totals.blocked > 0 && (
                  <span className="text-error">
                    {plan.totals.blocked} blocked
                  </span>
                )}
                {!planIsCurrent && (
                  <span className="text-warning">
                    Selection changed — preview again before posting.
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-auto rounded border border-border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 border-b border-border bg-surface text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2">Rule</th>
                      <th className="px-2">Property or company</th>
                      <th className="px-2 text-right">Amount</th>
                      <th className="px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.plan.map((p, i) => (
                      <tr
                        key={`${p.ruleId}-${p.periodDate}-${i}`}
                        className={
                          "border-b border-border/30 " + rowClass(p.status)
                        }
                      >
                        <td className="px-2 py-1 tabular-nums">
                          {new Date(p.periodDate).toLocaleDateString()}
                        </td>
                        <td className="px-2 py-1">
                          {p.memo || p.type}
                          {p.warnings.length > 0 && (
                            <span className="ml-1 text-xs text-warning">
                              ({p.warnings.join(", ")})
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {/* Allocated shares render as indented children of
                              the company they came from, so a split is
                              legible before it posts rather than after. */}
                          {p.scopes.map((s, si) => (
                            <div
                              key={`${s.propertyId ?? "co"}-${si}`}
                              className={
                                s.allocatedFromCompanyName
                                  ? "pl-3 text-xs text-fg-muted"
                                  : undefined
                              }
                            >
                              {s.allocatedFromCompanyName ? "↳ " : ""}
                              {s.propertyName}
                              {s.allocatedFromCompanyName ? (
                                <span className="ml-1">
                                  <CurrencyAmount
                                    cents={s.amountCents}
                                    convert={false}
                                  />
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <CurrencyAmount cents={p.amountCents} convert={false} />
                        </td>
                        <td className="px-2 py-1 text-xs">
                          {p.note ?? p.status}
                        </td>
                      </tr>
                    ))}
                    {plan.plan.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-2 py-4 text-fg-muted">
                          Nothing due through that date — everything is already
                          up to date.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={preview} disabled={busy}>
            {busy ? "Working…" : "Preview"}
          </Button>
          <Button
            onClick={post}
            disabled={busy || !planIsCurrent || plan?.plan.length === 0}
          >
            {plan && planIsCurrent
              ? `Post ${plan.plan.filter((p) => p.status === "will-post" || p.status === "possible-duplicate").length} entries`
              : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RecurringCatchUpModal;
