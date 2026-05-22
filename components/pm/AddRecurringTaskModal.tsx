// Add recurring task modal — Phase 5 (PDR §3.14).
// BR-TP-5: the taskType dropdown OMITS `Contact request`. The schema +
// model enforce the same; this is the UI affordance.
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
  RECURRING_FREQUENCIES,
  RECURRING_DURATIONS,
  WORK_PRIORITIES,
  type RecurringFrequency,
  type RecurringDuration,
  type WorkPriority,
} from "@/types/pm";

/** BR-TP-5 — Contact request omitted. */
const RECURRING_TASK_TYPES = [
  "To do",
  "Resident request",
  "Rental owner request",
] as const;
type RecurringTaskType = (typeof RECURRING_TASK_TYPES)[number];

interface PropertyOption {
  id: string;
  propertyName: string;
}

export interface AddRecurringTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function AddRecurringTaskModal({
  open,
  onClose,
  onSaved,
}: AddRecurringTaskModalProps) {
  const { toast } = useToast();
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);

  const [title, setTitle] = React.useState("");
  const [taskType, setTaskType] = React.useState<RecurringTaskType>("To do");
  const [cadence, setCadence] = React.useState<RecurringFrequency>("Monthly");
  const [nextDate, setNextDate] = React.useState("");
  const [priority, setPriority] = React.useState<WorkPriority>("Normal");
  const [propertyId, setPropertyId] = React.useState("");
  const [duration, setDuration] = React.useState<RecurringDuration>(
    "Until cancelled",
  );
  const [occurrenceCount, setOccurrenceCount] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) setProperties((await r.json()) as PropertyOption[]);
    });
  }, [open]);

  function reset() {
    setTitle("");
    setTaskType("To do");
    setCadence("Monthly");
    setNextDate("");
    setPriority("Normal");
    setPropertyId("");
    setDuration("Until cancelled");
    setOccurrenceCount("");
    setDescription("");
  }

  async function save() {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "error" });
      return;
    }
    if (!nextDate) {
      toast({ title: "Next date is required", variant: "error" });
      return;
    }
    if (duration === "End after N") {
      const n = Number(occurrenceCount);
      if (!Number.isFinite(n) || n < 1) {
        toast({
          title: "Occurrence count must be a positive integer",
          variant: "error",
        });
        return;
      }
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      taskType,
      cadence,
      nextDate: new Date(nextDate).toISOString(),
      priority,
      duration,
      description: description.trim() || undefined,
    };
    if (propertyId) payload.propertyId = propertyId;
    if (duration === "End after N") {
      payload.occurrenceCount = Number(occurrenceCount);
    }

    const res = await fetch("/api/pm/recurring-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setSaving(false);
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    reset();
    setSaving(false);
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title="Add recurring task"
          description="The cadence engine creates a fresh Task each time nextDate is reached."
          onClose={onClose}
        />

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rt-title">Title</Label>
            <Input
              id="rt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rt-type">Type</Label>
              <select
                id="rt-type"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={taskType}
                onChange={(e) =>
                  setTaskType(e.target.value as RecurringTaskType)
                }
              >
                {/* BR-TP-5 — `Contact request` intentionally absent. */}
                {RECURRING_TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-priority">Priority</Label>
              <select
                id="rt-priority"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as WorkPriority)
                }
              >
                {WORK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rt-cadence">Cadence</Label>
              <select
                id="rt-cadence"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={cadence}
                onChange={(e) =>
                  setCadence(e.target.value as RecurringFrequency)
                }
              >
                {RECURRING_FREQUENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-next">Next date</Label>
              <Input
                id="rt-next"
                type="date"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rt-property">Property</Label>
              <select
                id="rt-property"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
              >
                <option value="">— None —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.propertyName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-duration">Duration</Label>
              <select
                id="rt-duration"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={duration}
                onChange={(e) =>
                  setDuration(e.target.value as RecurringDuration)
                }
              >
                {RECURRING_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {duration === "End after N" && (
            <div className="space-y-1.5">
              <Label htmlFor="rt-count">Occurrence count</Label>
              <Input
                id="rt-count"
                type="number"
                min={1}
                value={occurrenceCount}
                onChange={(e) => setOccurrenceCount(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rt-description">Description</Label>
            <textarea
              id="rt-description"
              className="min-h-[60px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              maxLength={4000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Creating…" : "Create recurring task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
