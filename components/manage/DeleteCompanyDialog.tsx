"use client";

// Delete-company confirmation. Deletion is BLOCKED while the company still
// owns holdings (the server enforces this with a 409); when positionCount > 0
// the dialog explains how to proceed and disables the destructive action.
// Otherwise it confirms removal and notes that the cash balance goes with it.
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDeleteCompany, type ApiCompany } from "@/lib/hooks/useCompanies";
import { useUiStore } from "@/store/useUiStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useToast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export function DeleteCompanyDialog({
  company,
  onClose,
}: {
  company: ApiCompany | null;
  onClose: () => void;
}) {
  const del = useDeleteCompany();
  const isOffline = useUiStore((s) => s.isOffline);
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const { toast } = useToast();

  const blocked = (company?.positionCount ?? 0) > 0;
  const hasCash = (company?.cashBalance ?? 0) > 0;

  async function confirm() {
    if (!company || blocked) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to delete this company.",
        variant: "error",
      });
      return;
    }
    try {
      await del.mutateAsync(company.id);
      toast({
        title: "Company removed",
        description: `${company.name} was deleted.`,
        variant: "success",
      });
      onClose();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    }
  }

  const description = !company
    ? undefined
    : blocked
      ? `${company.name} still holds ${company.positionCount} ${
          company.positionCount === 1 ? "holding" : "holdings"
        }. Reassign or clear them (in a stock's "Held by" field) before deleting.`
      : `${company.name}${
          hasCash
            ? ` and its ${formatCurrency(company.cashBalance, company.cashCurrency, {
                format: numberFormat,
              })} cash balance`
            : ""
        } will be permanently removed. This cannot be undone.`;

  return (
    <Dialog open={Boolean(company)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title={blocked ? "Can't delete yet" : "Delete company?"}
          description={description}
          onClose={onClose}
        />
        {blocked && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface-highest p-3 text-[12px] text-fg-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
            <span>
              Open each of those holdings, change its <strong>Held by</strong>{" "}
              to “None” or another company, then delete this one.
            </span>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {blocked ? "Close" : "Cancel"}
          </Button>
          {!blocked && (
            <Button
              variant="destructive"
              onClick={confirm}
              disabled={del.isPending || isOffline}
            >
              {del.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
