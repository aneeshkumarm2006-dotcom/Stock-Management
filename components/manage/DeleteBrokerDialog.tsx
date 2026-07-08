"use client";

// Delete-broker confirmation. Deletion is BLOCKED while the broker still holds
// positions (the server enforces this with a 409); when positionCount > 0 the
// dialog explains how to proceed and disables the destructive action. Mirrors
// DeleteCompanyDialog.
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDeleteBroker, type ApiBroker } from "@/lib/hooks/useBrokers";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";

export function DeleteBrokerDialog({
  broker,
  onClose,
}: {
  broker: ApiBroker | null;
  onClose: () => void;
}) {
  const del = useDeleteBroker();
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();

  const blocked = (broker?.positionCount ?? 0) > 0;

  async function confirm() {
    if (!broker || blocked) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to delete this broker.",
        variant: "error",
      });
      return;
    }
    try {
      await del.mutateAsync(broker.id);
      toast({
        title: "Broker removed",
        description: `${broker.name} was deleted.`,
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

  const description = !broker
    ? undefined
    : blocked
      ? `${broker.name} still holds ${broker.positionCount} ${
          broker.positionCount === 1 ? "holding" : "holdings"
        }. Reassign or clear them (in a holding's "Broker" field) before deleting.`
      : `${broker.name} will be permanently removed. This cannot be undone.`;

  return (
    <Dialog open={Boolean(broker)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title={blocked ? "Can't delete yet" : "Delete broker?"}
          description={description}
          onClose={onClose}
        />
        {blocked && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface-highest p-3 text-[12px] text-fg-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
            <span>
              Open each of those holdings, change its <strong>Broker</strong> to
              “None” or another broker, then delete this one.
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
