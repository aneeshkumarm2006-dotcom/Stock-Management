// Request owner contribution modal (PDR §3.25, Phase 9). Opens from the
// Bills toolbar OR the Owner contributions sub-tab. Creates the
// OwnerContributionRequest, optionally fires the notify email, and
// flips status from `New` → `In progress` server-side on send.
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
import {
  OWNER_CONTRIBUTION_PRIORITIES,
  type OwnerContributionPriority,
} from "@/types/pm";

interface RentalOwnerOption {
  id: string;
  displayName: string;
}

interface RequestOwnerContributionModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  /** Optional Task to cross-link the new request to. */
  taskId?: string;
}

export function RequestOwnerContributionModal({
  open,
  onClose,
  onSaved,
  taskId,
}: RequestOwnerContributionModalProps) {
  const { toast } = useToast();
  const [owners, setOwners] = React.useState<RentalOwnerOption[]>([]);

  const [ownerId, setOwnerId] = React.useState("");
  const [propertiesScope, setPropertiesScope] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [dueDate, setDueDate] = React.useState(() =>
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [priority, setPriority] =
    React.useState<OwnerContributionPriority>("Normal");
  const [taskDescription, setTaskDescription] = React.useState("");
  const [sendEmailNow, setSendEmailNow] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    fetch("/api/pm/rental-owners").then(async (r) => {
      if (r.ok) setOwners((await r.json()) as RentalOwnerOption[]);
    });
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      setOwnerId("");
      setPropertiesScope("");
      setAmount("");
      setPriority("Normal");
      setTaskDescription("");
      setSendEmailNow(true);
    }
  }, [open]);

  async function save() {
    if (!ownerId) {
      toast({ title: "Pick an owner", variant: "error" });
      return;
    }
    if (!propertiesScope.trim()) {
      toast({ title: "Properties scope is required", variant: "error" });
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Amount must be positive", variant: "error" });
      return;
    }
    if (!taskDescription.trim()) {
      toast({ title: "Description is required", variant: "error" });
      return;
    }

    setSaving(true);
    const createRes = await fetch("/api/pm/owner-contribution-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "New",
        dueDate,
        propertiesScope: propertiesScope.trim(),
        taskDescription: taskDescription.trim(),
        requestedFromOwnerId: ownerId,
        priority,
        requestedAmount: amt,
        receivedAmount: 0,
        taskId: taskId ?? undefined,
      }),
    });
    if (!createRes.ok) {
      setSaving(false);
      const body = (await createRes.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to create request",
        variant: "error",
      });
      return;
    }

    const created = (await createRes.json()) as { id: string };
    if (sendEmailNow) {
      const sendRes = await fetch(
        `/api/pm/owner-contribution-requests/${created.id}/notify`,
        { method: "POST" },
      );
      if (!sendRes.ok) {
        const body = (await sendRes.json().catch(() => ({}))) as { error?: string };
        toast({
          title: `Created. Email failed: ${body.error ?? "unknown error"}`,
          variant: "error",
        });
        setSaving(false);
        // The request WAS created — close so the user isn't stuck on the form
        // re-submitting and creating duplicates (ADD-006).
        onClose();
        await onSaved();
        return;
      }
    }
    setSaving(false);
    toast({ title: "Owner contribution request created", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Request owner contribution" onClose={onClose} />

        <div className="space-y-3">
          <div>
            <Label htmlFor="owner">Owner</Label>
            <select
              id="owner"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">Select…</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="scope">Properties</Label>
            <Input
              id="scope"
              placeholder="e.g. 123 Main St — Unit A"
              value={propertiesScope}
              onChange={(e) => setPropertiesScope(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="amount">Amount (USD)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="due">Due date</Label>
              <Input
                id="due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="priority">Priority</Label>
            <select
              id="priority"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as OwnerContributionPriority)
              }
            >
              {OWNER_CONTRIBUTION_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="desc">Description</Label>
            <textarea
              id="desc"
              className="min-h-[80px] w-full rounded-md border border-border bg-bg-elevated p-2 text-sm"
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              maxLength={2000}
              placeholder="What is the contribution for?"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendEmailNow}
              onChange={(e) => setSendEmailNow(e.target.checked)}
            />
            Send owner an email now
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : sendEmailNow ? "Save & send" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RequestOwnerContributionModal;
