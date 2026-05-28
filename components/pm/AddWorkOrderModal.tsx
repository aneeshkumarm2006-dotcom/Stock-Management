// Add work-order modal (BR-MV-5 + BR-MV-6 + BR-MV-7).
//   - Toggle: "Create new task" vs "Add to existing task" (BR-MV-5).
//   - vendorId + assignedToUserId required (BR-MV-6).
//   - partsAndLabor inline grid with account picker (BR-MV-8).
//   - chargeWorkTo radio (Property | Lease | RentalOwner) per [G-B-30].
//   - "Create work order" + "Create work order and schedule event" buttons
//     (BR-MV-7 — schedule wires the calendar stub).
"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
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
  WORK_PRIORITIES,
  ENTRY_DETAILS,
  CHARGE_TARGET_TYPES,
  type WorkPriority,
  type EntryDetails,
  type ChargeTargetType,
} from "@/types/pm";
import { computeWarnings } from "@/lib/pm/warnings";
import { WarningInline } from "@/components/pm/WarningBadge";

interface VendorOption {
  id: string;
  displayName: string;
}
interface TaskOption {
  id: string;
  taskId: number;
  title: string;
}
interface ChartOfAccountOption {
  id: string;
  name: string;
}

interface PartsRow {
  qty: number;
  accountId: string;
  description: string;
  price: number;
}

export interface AddWorkOrderModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  /** When provided, the modal preselects taskId + skips the create/select
   *  toggle (used by a Task detail page's "Add work order" action). */
  presetTaskId?: string;
}

export function AddWorkOrderModal({
  open,
  onClose,
  onSaved,
  presetTaskId,
}: AddWorkOrderModalProps) {
  const { toast } = useToast();
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [tasks, setTasks] = React.useState<TaskOption[]>([]);
  const [accounts, setAccounts] = React.useState<ChartOfAccountOption[]>([]);

  const [taskMode, setTaskMode] = React.useState<"new" | "existing">(
    presetTaskId ? "existing" : "new",
  );
  const [taskId, setTaskId] = React.useState<string>(presetTaskId ?? "");
  const [taskTitle, setTaskTitle] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [vendorId, setVendorId] = React.useState("");
  const [assignedToUserId, setAssignedToUserId] = React.useState("");
  const [priority, setPriority] = React.useState<WorkPriority>("Normal");
  const [dueDate, setDueDate] = React.useState("");
  const [entryDetails, setEntryDetails] = React.useState<EntryDetails | "">("");
  const [chargeType, setChargeType] = React.useState<ChargeTargetType | "">("");
  const [chargeId, setChargeId] = React.useState("");
  const [workToBePerformed, setWorkToBePerformed] = React.useState("");
  const [vendorNotes, setVendorNotes] = React.useState("");
  const [parts, setParts] = React.useState<PartsRow[]>([
    { qty: 1, accountId: "", description: "", price: 0 },
  ]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok) setVendors((await r.json()) as VendorOption[]);
    });
    fetch("/api/pm/tasks?includeTerminal=0").then(async (r) => {
      if (r.ok) setTasks((await r.json()) as TaskOption[]);
    });
    fetch("/api/pm/chart-of-accounts").then(async (r) => {
      if (r.ok) {
        const rows = (await r.json()) as Array<{ id: string; name: string }>;
        setAccounts(rows);
      }
    });
    // Phase 4 has no /api/pm/users endpoint; assignees pulled from the same
    // session pool. Use the impersonation route's user list when available;
    // otherwise leave empty (modal still allows free entry of current user).
  }, [open]);

  function reset() {
    setTaskMode(presetTaskId ? "existing" : "new");
    setTaskId(presetTaskId ?? "");
    setTaskTitle("");
    setSubject("");
    setVendorId("");
    setAssignedToUserId("");
    setPriority("Normal");
    setDueDate("");
    setEntryDetails("");
    setChargeType("");
    setChargeId("");
    setWorkToBePerformed("");
    setVendorNotes("");
    setParts([{ qty: 1, accountId: "", description: "", price: 0 }]);
  }

  function addPart() {
    setParts([
      ...parts,
      { qty: 1, accountId: "", description: "", price: 0 },
    ]);
  }
  function removePart(idx: number) {
    setParts(parts.filter((_, i) => i !== idx));
  }
  function updatePart<K extends keyof PartsRow>(
    idx: number,
    key: K,
    value: PartsRow[K],
  ) {
    setParts(
      parts.map((p, i) =>
        i === idx ? ({ ...p, [key]: value } as PartsRow) : p,
      ),
    );
  }

  function buildPayload() {
    const payload: Record<string, unknown> = {
      subject: subject.trim(),
      vendorId,
      assignedToUserId,
      priority,
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      entryDetails: entryDetails || undefined,
      workToBePerformed: workToBePerformed.trim() || undefined,
      vendorNotes: vendorNotes.trim() || undefined,
      partsAndLabor: parts
        .filter((p) => p.accountId)
        .map((p) => ({
          qty: Number(p.qty) || 0,
          accountId: p.accountId,
          description: p.description.trim() || undefined,
          price: Number(p.price) || 0,
        })),
    };
    if (chargeType && chargeId) {
      payload.chargeWorkTo = { type: chargeType, id: chargeId };
    }
    if (taskMode === "existing") {
      payload.taskId = taskId;
    } else {
      payload.taskNew = {
        title: taskTitle.trim() || subject.trim() || "Maintenance task",
      };
    }
    return payload;
  }

  // Presence checks (subject, task pick, charge target) moved to non-blocking
  // warnings. The form can submit either way; the API stamps the warnings on
  // the created row. The task auto-defaults to a new task when none is picked,
  // since the WO model still needs a parent for activity-log threading.

  async function save(scheduleEvent: boolean) {
    setSaving(true);
    const res = await fetch("/api/pm/work-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    if (!res.ok) {
      setSaving(false);
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Failed",
        description: errBody.error,
        variant: "error",
      });
      return;
    }
    const created = (await res.json()) as { id: string };

    if (scheduleEvent) {
      // Default the event to today; the WO detail page can update later.
      const now = new Date();
      const sched = await fetch(
        `/api/pm/work-orders/${created.id}/schedule-event`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: now.toISOString(),
            endDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
            title: `WO: ${subject.trim()}`,
          }),
        },
      );
      if (!sched.ok) {
        toast({
          title: "Work order saved, but scheduling failed",
          variant: "error",
        });
      } else {
        toast({ title: "Work order + calendar event saved", variant: "success" });
      }
    }
    setSaving(false);
    reset();
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader title="Add work order" onClose={onClose} />
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="wo-subject">Subject *</Label>
            <Input
              id="wo-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Leaky faucet at 160 East End Avenue - 1"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="wo-vendor">Vendor</Label>
              <select
                id="wo-vendor"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              >
                <option value="">— (Assign later)</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.displayName}
                  </option>
                ))}
              </select>
              {/* Unified WarningInline below DialogFooter handles this. */}
            </div>
            <div className="space-y-1">
              <Label htmlFor="wo-assignee">Staff assignee</Label>
              <Input
                id="wo-assignee"
                placeholder="Paste User ID (multi-user picker lands Phase 5)"
                value={assignedToUserId}
                onChange={(e) => setAssignedToUserId(e.target.value)}
              />
              {/* Unified WarningInline below DialogFooter handles this. */}
            </div>
          </div>

          {!presetTaskId && (
            <div className="space-y-2 rounded border border-border bg-surface p-3">
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="task-mode"
                    checked={taskMode === "new"}
                    onChange={() => setTaskMode("new")}
                  />
                  Create new task
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="task-mode"
                    checked={taskMode === "existing"}
                    onChange={() => setTaskMode("existing")}
                  />
                  Add to existing task
                </label>
              </div>
              {taskMode === "new" ? (
                <div className="space-y-1">
                  <Label htmlFor="wo-task-title">Task title (BR-MV-5)</Label>
                  <Input
                    id="wo-task-title"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="Defaults to subject"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="wo-task">Existing task</Label>
                  <select
                    id="wo-task"
                    className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                    value={taskId}
                    onChange={(e) => setTaskId(e.target.value)}
                  >
                    <option value="">Choose task…</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        #{t.taskId} — {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="wo-priority">Priority</Label>
              <select
                id="wo-priority"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={priority}
                onChange={(e) => setPriority(e.target.value as WorkPriority)}
              >
                {WORK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="wo-due">Due date</Label>
              <Input
                id="wo-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wo-entry">Entry details</Label>
              <select
                id="wo-entry"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={entryDetails}
                onChange={(e) =>
                  setEntryDetails(e.target.value as EntryDetails | "")
                }
              >
                <option value="">—</option>
                {ENTRY_DETAILS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="wo-charge">Charge work to ([G-B-30])</Label>
            <div className="flex gap-2">
              <select
                id="wo-charge"
                className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={chargeType}
                onChange={(e) => {
                  setChargeType(e.target.value as ChargeTargetType | "");
                  setChargeId("");
                }}
              >
                <option value="">—</option>
                {CHARGE_TARGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Target ID"
                value={chargeId}
                onChange={(e) => setChargeId(e.target.value)}
                disabled={!chargeType}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-widest text-fg-muted">
                Parts and labor (BR-MV-8)
              </h4>
              <Button size="sm" variant="outline" onClick={addPart}>
                <Plus className="h-3.5 w-3.5" /> Add row
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-1">Qty</th>
                  <th>Account</th>
                  <th>Description</th>
                  <th>Price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {parts.map((p, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-1 w-16">
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        value={p.qty}
                        onChange={(e) =>
                          updatePart(i, "qty", Number(e.target.value))
                        }
                      />
                    </td>
                    <td className="w-56">
                      <select
                        className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
                        value={p.accountId}
                        onChange={(e) => updatePart(i, "accountId", e.target.value)}
                      >
                        <option value="">Choose…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Input
                        value={p.description}
                        onChange={(e) =>
                          updatePart(i, "description", e.target.value)
                        }
                      />
                    </td>
                    <td className="w-28">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={p.price}
                        onChange={(e) =>
                          updatePart(i, "price", Number(e.target.value))
                        }
                      />
                    </td>
                    <td className="w-8 text-right">
                      <button
                        type="button"
                        onClick={() => removePart(i)}
                        className="text-fg-muted hover:text-error"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="wo-work">Work to be performed</Label>
              <textarea
                id="wo-work"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                rows={3}
                value={workToBePerformed}
                onChange={(e) => setWorkToBePerformed(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wo-notes">Notes to vendor</Label>
              <textarea
                id="wo-notes"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                rows={3}
                value={vendorNotes}
                onChange={(e) => setVendorNotes(e.target.value)}
              />
            </div>
          </div>

          <WarningInline
            warnings={computeWarnings(
              {
                subject,
                vendorId,
                assignedToUserId,
                chargeWorkTo:
                  chargeType
                    ? { type: chargeType, id: chargeId }
                    : null,
              },
              "WorkOrder",
            )}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => save(true)}
            disabled={saving}
          >
            {saving ? "Saving…" : "Create + schedule event"}
          </Button>
          <Button onClick={() => save(false)} disabled={saving}>
            {saving ? "Saving…" : "Create work order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
