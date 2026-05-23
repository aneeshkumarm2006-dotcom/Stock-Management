// Collect management fees modal (PDR §3.27, BR-AC-16). Captures the
// period window + optional property filter, posts to
// /api/pm/management-fees/collect, and surfaces the per-property
// posted/skipped result.
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

interface CollectResult {
  posted: Array<{
    propertyId: string;
    propertyName: string;
    feeCents: number;
    journalEntryId: string;
  }>;
  skipped: Array<{ propertyId: string; reason: string }>;
}

interface CollectManagementFeesModalProps {
  open: boolean;
  onClose: () => void;
  onPosted: () => Promise<void> | void;
}

export function CollectManagementFeesModal({
  open,
  onClose,
  onPosted,
}: CollectManagementFeesModalProps) {
  const { toast } = useToast();
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  );

  const [periodStart, setPeriodStart] = React.useState(
    firstOfMonth.toISOString().slice(0, 10),
  );
  const [periodEnd, setPeriodEnd] = React.useState(
    lastOfMonth.toISOString().slice(0, 10),
  );
  const [saving, setSaving] = React.useState(false);
  const [result, setResult] = React.useState<CollectResult | null>(null);

  React.useEffect(() => {
    if (!open) setResult(null);
  }, [open]);

  async function collect() {
    setSaving(true);
    const r = await fetch("/api/pm/management-fees/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodStart, periodEnd }),
    });
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Collection failed",
        variant: "error",
      });
      return;
    }
    const out = (await r.json()) as CollectResult;
    setResult(out);
    toast({
      title: `Posted ${out.posted.length} management fee${
        out.posted.length === 1 ? "" : "s"
      }`,
      variant: "success",
    });
    await onPosted();
  }

  const totalPostedCents = result?.posted.reduce(
    (s, p) => s + p.feeCents,
    0,
  ) ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Collect management fees" onClose={onClose} />
        <div className="space-y-3">
          {!result && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cf-start">Period start</Label>
                <Input
                  id="cf-start"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cf-end">Period end</Label>
                <Input
                  id="cf-end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>
          )}

          {!result && (
            <p className="text-xs text-fg-muted">
              Posts a cross-property journal entry per active
              ManagementFeeAgreement: debit per-property{" "}
              <em>Management Fee Expense</em>, credit company{" "}
              <em>Management Fee Income</em>. Already-collected properties
              are skipped automatically.
            </p>
          )}

          {result && (
            <div className="space-y-3 text-sm">
              <p>
                Posted <strong>{result.posted.length}</strong> properties ·
                total{" "}
                <strong>
                  <CurrencyAmount cents={totalPostedCents} />
                </strong>
              </p>
              {result.posted.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-fg-muted">
                    <tr>
                      <th className="text-left">Property</th>
                      <th className="text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.posted.map((p) => (
                      <tr
                        key={p.propertyId}
                        className="border-b border-border/40"
                      >
                        <td className="py-1">{p.propertyName}</td>
                        <td className="text-right tabular-nums">
                          <CurrencyAmount cents={p.feeCents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {result.skipped.length > 0 && (
                <details className="text-xs text-fg-muted">
                  <summary>
                    Skipped {result.skipped.length} properties
                  </summary>
                  <ul className="mt-1 list-disc pl-4">
                    {result.skipped.map((s) => (
                      <li key={s.propertyId}>
                        {s.propertyId.slice(-6)}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={collect} disabled={saving}>
              {saving ? "Posting…" : "Collect"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CollectManagementFeesModal;
