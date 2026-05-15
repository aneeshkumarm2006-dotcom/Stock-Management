"use client";

// Delete-position confirmation (PDR §5.1 — "Delete Position: with
// confirmation"). Modal gate before the destructive DELETE; mutations are
// blocked while offline (PDR §11).
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDeletePosition, type PortfolioRow } from "@/lib/hooks/usePortfolio";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";

export function DeletePositionDialog({
  row,
  onClose,
}: {
  row: PortfolioRow | null;
  onClose: () => void;
}) {
  const del = useDeletePosition();
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();

  async function confirm() {
    if (!row) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to delete this position.",
        variant: "error",
      });
      return;
    }
    try {
      await del.mutateAsync(row.id);
      toast({
        title: "Position removed",
        description: `${row.ticker} was deleted from your portfolio.`,
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

  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title="Delete position?"
          description={
            row
              ? `${row.ticker} (${row.exchange}) and its cost basis will be permanently removed. This cannot be undone.`
              : undefined
          }
          onClose={onClose}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
