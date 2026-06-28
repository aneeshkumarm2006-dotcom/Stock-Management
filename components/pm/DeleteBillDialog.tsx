"use client";

// Delete-bill confirmation. Offers two ways to remove a posted bill:
//   • Delete permanently (mode=hard) — the bill and its journal entry are wiped
//     from the GL and Financials; only an activity-log line survives.
//   • Void instead (mode=void) — keeps the bill for audit and writes a reversing
//     journal entry (a reversal row stays in the GL).
// Bills with payments are blocked (the server enforces this with a 409); the
// dialog surfaces that as a "void the payments first" state. Mutations are
// blocked while offline (PDR §11).
import * as React from "react";
import { AlertTriangle, Loader2, Trash2, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";

export interface DeleteBillTarget {
  id: string;
  /** Cents. */
  amount: number;
  status: string;
}

export function DeleteBillDialog({
  bill,
  onClose,
  onDeleted,
}: {
  bill: DeleteBillTarget | null;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const [saving, setSaving] = React.useState<null | "hard" | "void">(null);

  // Payments block deletion; the API 409 is the source of truth, but reflect the
  // known statuses up front so the destructive actions aren't even offered.
  const blocked =
    bill?.status === "Partially paid" || bill?.status === "Paid";
  // Voiding only applies to a posted bill — a Draft has no journal entry, so the
  // only sensible action there is a permanent delete.
  const canVoid = Boolean(bill) && bill?.status !== "Draft";

  async function run(mode: "hard" | "void") {
    if (!bill || blocked || saving) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to delete this bill.",
        variant: "error",
      });
      return;
    }
    setSaving(mode);
    try {
      const res = await fetch(`/api/pm/bills/${bill.id}?mode=${mode}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: mode === "void" ? "Void failed" : "Delete failed",
          description: err.error ?? "Please try again.",
          variant: "error",
        });
        return;
      }
      toast({
        title: mode === "void" ? "Bill voided" : "Bill deleted",
        description:
          mode === "void"
            ? "A reversing entry was written to keep the audit trail."
            : "The bill and its journal entry were removed.",
        variant: "success",
      });
      onClose();
      await onDeleted();
    } catch {
      toast({
        title: mode === "void" ? "Void failed" : "Delete failed",
        description: "Please try again.",
        variant: "error",
      });
    } finally {
      setSaving(null);
    }
  }

  const amount = bill ? `$${(bill.amount / 100).toFixed(2)}` : "";

  return (
    <Dialog open={Boolean(bill)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title={blocked ? "Can't delete yet" : "Delete bill?"}
          description={
            !bill
              ? undefined
              : blocked
                ? "This bill has payments applied. Void the payments first, then delete or void the bill."
                : `Choose how to remove the ${amount} bill from the general ledger.`
          }
          onClose={onClose}
        />
        {blocked ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface-highest p-3 text-[12px] text-fg-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
            <span>
              Open the bill&apos;s payments and void them before removing the
              bill.
            </span>
          </div>
        ) : (
          <div className="space-y-2 text-[12px] text-fg-muted">
            <p>
              <strong className="text-fg">Delete permanently</strong> removes the
              bill{canVoid ? " and its journal entry" : ""} entirely — nothing
              remains in the general ledger or Financials. This cannot be undone.
            </p>
            {canVoid && (
              <p>
                <strong className="text-fg">Void</strong> keeps the bill for audit
                and writes a reversing journal entry (a reversal row stays in the
                general ledger).
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {blocked ? "Close" : "Cancel"}
          </Button>
          {!blocked && (
            <>
              {canVoid && (
                <Button
                  variant="outline"
                  onClick={() => run("void")}
                  disabled={saving !== null || isOffline}
                >
                  {saving === "void" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Voiding…
                    </>
                  ) : (
                    <>
                      <Undo2 className="h-4 w-4" />
                      Void instead
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => run("hard")}
                disabled={saving !== null || isOffline}
              >
                {saving === "hard" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete permanently
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
