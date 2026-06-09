"use client";

// Monthly value refresh for a manually-valued holding (mutual fund / cash).
// One input, defaulted to the current value; submitting PATCHes
// { mode: 'updateValue', currentValue } which also stamps valueAsOf = now, so
// the stale red dot clears immediately on success.
import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useUpdatePosition,
  type PortfolioRow,
} from "@/lib/hooks/usePortfolio";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";

export function UpdateValueDialog({
  row,
  onClose,
}: {
  row: PortfolioRow | null;
  onClose: () => void;
}) {
  const update = useUpdatePosition();
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (row) setValue(String(row.currentValueNative ?? ""));
  }, [row]);

  async function confirm() {
    if (!row) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to update the value.",
        variant: "error",
      });
      return;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      toast({
        title: "Invalid value",
        description: "Enter a non-negative number.",
        variant: "error",
      });
      return;
    }
    try {
      await update.mutateAsync({
        id: row.id,
        input: { mode: "updateValue", currentValue: num },
      });
      toast({
        title: "Value updated",
        description: `${row.label ?? row.name ?? "Holding"} marked as of today.`,
        variant: "success",
      });
      onClose();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    }
  }

  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title="Update current value"
          description={
            row
              ? `Set the latest market value for ${row.label ?? row.name} (${row.nativeCurrency}). The "as of" date is set to today.`
              : undefined
          }
          onClose={onClose}
        />
        <div className="px-1 py-2">
          <Label htmlFor="update-value" className="mb-1.5 block">
            Current value
          </Label>
          <Input
            id="update-value"
            type="number"
            step="any"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={update.isPending || isOffline}>
            {update.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Save value
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
