// Cancel-draft confirmation dialog. [G-B-1] — cancel is reversible while
// `promotedToLeaseId == null` (the route lets a subsequent PATCH flip the
// executionStatus back to Draft).
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

interface CancelDraftLeaseDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  draftLeaseId: string;
}

export function CancelDraftLeaseDialog({
  open,
  onClose,
  onSaved,
  draftLeaseId,
}: CancelDraftLeaseDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/pm/draft-leases/${draftLeaseId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Cancel failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    toast({ title: "Draft lease cancelled" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader title="Cancel draft lease?" />
        <p className="text-sm text-muted-foreground">
          This draft can be re-opened later ([G-B-1] — cancelled drafts revert
          to Draft on a subsequent edit).
        </p>
        <div>
          <Label>Reason (optional)</Label>
          <textarea
            className="w-full rounded border bg-background px-2 py-1.5 text-sm"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep draft
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Cancel draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
