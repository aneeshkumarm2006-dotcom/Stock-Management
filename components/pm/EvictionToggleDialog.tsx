// Eviction toggle confirmation dialog. BR-LL-3 — overlay attribute, not a
// status. Setter takes an optional note.
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

interface EvictionToggleDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  leaseId: string;
  evictionPending: boolean;
  currentNote?: string;
}

export function EvictionToggleDialog({
  open,
  onClose,
  onSaved,
  leaseId,
  evictionPending,
  currentNote,
}: EvictionToggleDialogProps) {
  const { toast } = useToast();
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const nextValue = !evictionPending;

  React.useEffect(() => {
    if (!open) return;
    setNote(currentNote ?? "");
  }, [open, currentNote]);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/pm/leases/${leaseId}/eviction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evictionPending: nextValue,
        evictionPendingNote: nextValue ? note : "",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Save failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    toast({
      title: nextValue ? "Eviction pending flagged" : "Eviction pending cleared",
    });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title={nextValue ? "Flag eviction pending" : "Clear eviction pending"}
        />
        <p className="text-sm text-muted-foreground">
          {nextValue
            ? "EVICTION PENDING is an overlay attribute, not a status (BR-LL-3). The lease keeps its current status; the rent-roll row gains a red banner."
            : "Remove the EVICTION PENDING overlay from this lease."}
        </p>
        {nextValue && (
          <div>
            <Label>Note (optional)</Label>
            <textarea
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : nextValue ? "Flag" : "Clear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
