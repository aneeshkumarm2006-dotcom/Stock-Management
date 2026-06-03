// Reconciliation wizard (PDR §3.27a, BR-AC-17). Three steps:
//   1. Statement — pick window + ending balance + optional service
//      charge / interest.
//   2. Clear lines — checkbox table of uncleared JE lines hitting the
//      bank account inside the window; running cleared total + live
//      difference vs statement.
//   3. Review + commit — disabled when difference != 0; commit calls
//      POST /commit which posts adjustment JE + LockedPeriodPolicy.
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
import { toCents, fromCents } from "@/lib/pm/currency";

interface UnclearedRow {
  journalEntryId: string;
  lineId: string;
  date: string;
  memo: string;
  debit: number;
  credit: number;
}

interface ReconciliationDetail {
  id: string;
  bankAccountId: string;
  status: string;
  startDate: string;
  endDate: string;
  statementEndingBalance: number;
  bookEndingBalance: number;
  difference: number;
  notes: string;
  clearedLines: Array<{ journalEntryId: string; lineId: string }>;
  unclearedLines: UnclearedRow[];
}

interface ReconciliationWizardProps {
  open: boolean;
  bankAccountId: string;
  /** When resuming an in-progress reconciliation, pass its id. */
  resumeReconciliationId?: string;
  onClose: () => void;
  onCommitted: () => Promise<void> | void;
}

type Step = 1 | 2 | 3;

export function ReconciliationWizard({
  open,
  bankAccountId,
  resumeReconciliationId,
  onClose,
  onCommitted,
}: ReconciliationWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = React.useState<Step>(1);
  const [recId, setRecId] = React.useState<string | null>(
    resumeReconciliationId ?? null,
  );
  const [rec, setRec] = React.useState<ReconciliationDetail | null>(null);

  const [startDate, setStartDate] = React.useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [endingBalance, setEndingBalance] = React.useState("0");
  const [serviceCharge, setServiceCharge] = React.useState("0");
  const [interest, setInterest] = React.useState("0");

  const [clearedKeys, setClearedKeys] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  // True once the user has typed into the ending-balance field. While dirty,
  // loadRec() must not overwrite their value with the server's (EDIT-006).
  const endingBalanceDirty = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    endingBalanceDirty.current = false;
    if (resumeReconciliationId) {
      // Jump to step 2 with existing rec.
      setRecId(resumeReconciliationId);
      setStep(2);
    } else {
      setStep(1);
      setRecId(null);
      setClearedKeys(new Set());
      setRec(null);
    }
  }, [open, resumeReconciliationId]);

  const loadRec = React.useCallback(async () => {
    if (!recId) return;
    const r = await fetch(`/api/pm/reconciliations/${recId}`);
    if (!r.ok) return;
    const d = (await r.json()) as ReconciliationDetail;
    setRec(d);
    // Don't clobber an in-progress local edit of the ending balance with the
    // server's value (EDIT-006). Only adopt the server value when the user
    // hasn't typed into the field since this rec loaded.
    if (!endingBalanceDirty.current) {
      setEndingBalance(String(fromCents(d.statementEndingBalance).toFixed(2)));
    }
    setClearedKeys(
      new Set(
        d.clearedLines.map((c) => `${c.journalEntryId}:${c.lineId}`),
      ),
    );
  }, [recId]);

  React.useEffect(() => {
    if (open && recId) void loadRec();
  }, [open, recId, loadRec]);

  async function startReconciliation() {
    setSaving(true);
    const r = await fetch("/api/pm/reconciliations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bankAccountId,
        startDate,
        endDate,
        statementEndingBalance: Number(endingBalance),
      }),
    });
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to start reconciliation",
        variant: "error",
      });
      return;
    }
    const created = (await r.json()) as { id: string };
    endingBalanceDirty.current = false;
    setRecId(created.id);
    setStep(2);
  }

  // Continue from step 1 when a reconciliation already exists (resumed, or the
  // user went Back from step 2 and edited the balance). The previous code went
  // straight to setStep(2), silently dropping any balance change (EDIT-006).
  // Persist the new ending balance first, await it, then advance.
  async function continueFromStep1() {
    if (!recId) {
      // No rec yet — fall through to the create path.
      await startReconciliation();
      return;
    }
    setSaving(true);
    const r = await fetch(`/api/pm/reconciliations/${recId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementEndingBalance: Number(endingBalance) }),
    });
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to update statement",
        variant: "error",
      });
      return;
    }
    // The local endingBalance is now persisted; let loadRec resync uncleared
    // lines without treating the field as dirty.
    endingBalanceDirty.current = false;
    setStep(2);
  }

  async function flushClearedSet() {
    if (!recId) return;
    setSaving(true);
    const r = await fetch(`/api/pm/reconciliations/${recId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clearedLines: Array.from(clearedKeys).map((k) => {
          const [jeId, lineId] = k.split(":");
          return { journalEntryId: jeId, lineId };
        }),
        statementEndingBalance: Number(endingBalance),
      }),
    });
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to save",
        variant: "error",
      });
      return false;
    }
    // The balance was just persisted with this flush, so a subsequent loadRec
    // can safely re-adopt the server value (which now matches local).
    endingBalanceDirty.current = false;
    // loadRec re-GETs and recomputes bookEndingBalance from the just-saved
    // cleared lines, so the Step 3 difference reflects the current cleared set
    // rather than a stale book balance (EDIT-007).
    await loadRec();
    return true;
  }

  function toggleCleared(key: string) {
    setClearedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function commit() {
    if (!recId) return;
    if (!(await flushClearedSet())) return;
    setSaving(true);
    const r = await fetch(`/api/pm/reconciliations/${recId}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceChargeCents: toCents(serviceCharge),
        interestEarnedCents: toCents(interest),
      }),
    });
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to commit",
        variant: "error",
      });
      return;
    }
    toast({ title: "Reconciliation committed", variant: "success" });
    await onCommitted();
    onClose();
  }

  // Live cleared total = sum of cleared debits − credits, then +
  // interest − serviceCharge.
  const clearedTotalCents = React.useMemo(() => {
    if (!rec) return 0;
    let net = 0;
    for (const row of rec.unclearedLines) {
      const k = `${row.journalEntryId}:${row.lineId}`;
      if (!clearedKeys.has(k)) continue;
      net += (row.debit ?? 0) - (row.credit ?? 0);
    }
    return net;
  }, [rec, clearedKeys]);

  const adjustedBookCents =
    (rec?.bookEndingBalance ?? 0) -
    toCents(serviceCharge) +
    toCents(interest);
  const liveDifference = toCents(endingBalance) - adjustedBookCents;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader
          title={`Reconcile bank account — Step ${step} of 3`}
          onClose={onClose}
        />

        {step === 1 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rec-start">Statement start</Label>
                <Input
                  id="rec-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rec-end">Statement end</Label>
                <Input
                  id="rec-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="rec-balance">Statement ending balance</Label>
              <Input
                id="rec-balance"
                type="number"
                step="0.01"
                value={endingBalance}
                onChange={(e) => {
                  endingBalanceDirty.current = true;
                  setEndingBalance(e.target.value);
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rec-svc">Service charge</Label>
                <Input
                  id="rec-svc"
                  type="number"
                  step="0.01"
                  min="0"
                  value={serviceCharge}
                  onChange={(e) => setServiceCharge(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rec-int">Interest earned</Label>
                <Input
                  id="rec-int"
                  type="number"
                  step="0.01"
                  min="0"
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && rec && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span>
                Statement:{" "}
                <CurrencyAmount cents={toCents(endingBalance)} />
              </span>
              <span className="text-fg-muted">−</span>
              <span>
                Book + adj:{" "}
                <CurrencyAmount cents={adjustedBookCents} />
              </span>
              <span className="text-fg-muted">=</span>
              <span
                className={
                  liveDifference === 0
                    ? "font-bold text-success"
                    : "font-bold text-error"
                }
              >
                Difference: <CurrencyAmount cents={liveDifference} />
              </span>
              <span className="ml-auto text-xs text-fg-muted">
                Cleared net: <CurrencyAmount cents={clearedTotalCents} />
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-bg-elevated text-left text-xs uppercase tracking-widest text-fg-muted">
                  <tr>
                    <th className="py-2 w-10" />
                    <th>Date</th>
                    <th>Memo</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.unclearedLines.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-3 text-center text-fg-muted">
                        No uncleared lines in this window.
                      </td>
                    </tr>
                  ) : (
                    rec.unclearedLines.map((row) => {
                      const key = `${row.journalEntryId}:${row.lineId}`;
                      const checked = clearedKeys.has(key);
                      return (
                        <tr
                          key={key}
                          className={
                            "border-b border-border/40 " +
                            (checked ? "bg-success/5" : "")
                          }
                        >
                          <td className="py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCleared(key)}
                            />
                          </td>
                          <td className="text-fg-muted">
                            {new Date(row.date).toISOString().slice(0, 10)}
                          </td>
                          <td>{row.memo || "—"}</td>
                          <td className="text-right tabular-nums">
                            {row.debit > 0 ? (
                              <CurrencyAmount cents={row.debit} />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-right tabular-nums">
                            {row.credit > 0 ? (
                              <CurrencyAmount cents={row.credit} />
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 3 && rec && (
          <div className="space-y-3 text-sm">
            <p>
              Statement window:{" "}
              {new Date(rec.startDate).toISOString().slice(0, 10)} →{" "}
              {new Date(rec.endDate).toISOString().slice(0, 10)}
            </p>
            <p>
              Statement ending balance:{" "}
              <CurrencyAmount cents={toCents(endingBalance)} />
            </p>
            <p>
              Book ending balance (+ adjustments):{" "}
              <CurrencyAmount cents={adjustedBookCents} />
            </p>
            <p
              className={
                liveDifference === 0
                  ? "font-bold text-success"
                  : "font-bold text-error"
              }
            >
              Difference: <CurrencyAmount cents={liveDifference} />
            </p>
            <p>
              Cleared lines: <strong>{clearedKeys.size}</strong>
            </p>
            <p className="text-xs text-fg-muted">
              On commit, cleared lines are stamped read-only and a global
              locked-period policy through{" "}
              {new Date(rec.endDate).toISOString().slice(0, 10)} is issued
              (BR-AC-17). Service charge and interest post a balanced
              adjustment JE.
            </p>
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <Button
              variant="outline"
              onClick={async () => {
                // EDIT-008: cleared-line toggles live only in local state until
                // flushed. Going Back from step 2 without flushing loses them
                // (loadRec would reload the server's older set). Persist first,
                // then step back. From step 3, no cleared edits are made, so a
                // plain step-back is safe.
                if (step === 2) {
                  if (!(await flushClearedSet())) return;
                }
                setStep((s) => (s - 1) as Step);
              }}
              disabled={saving}
            >
              Back
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {step === 1 && (
              <Button
                onClick={recId ? continueFromStep1 : startReconciliation}
                disabled={saving}
              >
                {recId ? "Continue" : "Start"}
              </Button>
            )}
            {step === 2 && (
              <Button
                onClick={async () => {
                  if (await flushClearedSet()) setStep(3);
                }}
                disabled={saving}
              >
                Continue →
              </Button>
            )}
            {step === 3 && (
              <Button
                onClick={commit}
                disabled={saving || liveDifference !== 0}
              >
                {saving ? "Committing…" : "Commit"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReconciliationWizard;
