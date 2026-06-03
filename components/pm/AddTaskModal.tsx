// Add task modal — Phase 5 surface backed by POST /api/pm/tasks.
//
// taskType is the source-of-truth for which source* picker is visible:
//   - Resident request → sourceTenantId picker
//   - Rental owner request → sourceOwnerId picker
//   - Contact request → sourceContactId free-text id (no surface yet; manual)
//   - To do → no source field
//
// The form is intentionally compact; deeper editing happens on the Task
// detail page.
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
  TASK_TYPES,
  WORK_PRIORITIES,
  type TaskType,
  type WorkPriority,
} from "@/types/pm";

interface PropertyOption {
  id: string;
  propertyName: string;
}
interface TenantOption {
  id: string;
  displayName: string;
}
interface OwnerOption {
  id: string;
  displayName: string;
}
interface ProjectOption {
  id: string;
  name: string;
}

export interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (taskId: string) => Promise<void> | void;
  /** Optional pre-filled property scope (e.g. from Property detail). */
  presetPropertyId?: string;
  /** Optional pre-filled project link (e.g. from Project detail). */
  presetProjectId?: string;
  /** When set, the modal loads this task and saves via PATCH. */
  editingId?: string;
}

export function AddTaskModal({
  open,
  onClose,
  onSaved,
  presetPropertyId,
  presetProjectId,
  editingId,
}: AddTaskModalProps) {
  const isEdit = Boolean(editingId);
  const { toast } = useToast();
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [tenants, setTenants] = React.useState<TenantOption[]>([]);
  const [owners, setOwners] = React.useState<OwnerOption[]>([]);
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);

  const [title, setTitle] = React.useState("");
  const [taskType, setTaskType] = React.useState<TaskType>("To do");
  const [priority, setPriority] = React.useState<WorkPriority>("Normal");
  const [dueDate, setDueDate] = React.useState("");
  const [propertyId, setPropertyId] = React.useState(presetPropertyId ?? "");
  const [sourceTenantId, setSourceTenantId] = React.useState("");
  const [sourceOwnerId, setSourceOwnerId] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [projectId, setProjectId] = React.useState(presetProjectId ?? "");
  const [saving, setSaving] = React.useState(false);
  // Full project-link set for the task being edited. We only render a single
  // project picker, but the task may belong to several projects; keep the
  // rest so a PATCH doesn't drop them (ADD-013).
  const [projectIds, setProjectIds] = React.useState<string[]>([]);
  // Track open transitions so the preset effect only fires when the modal
  // actually opens, not on every parent re-render (ADD-005).
  const prevOpen = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) setProperties((await r.json()) as PropertyOption[]);
    });
    fetch("/api/pm/tenants").then(async (r) => {
      if (r.ok) setTenants((await r.json()) as TenantOption[]);
    });
    fetch("/api/pm/rental-owners").then(async (r) => {
      if (r.ok) setOwners((await r.json()) as OwnerOption[]);
    });
    fetch("/api/pm/projects?status=in-progress").then(async (r) => {
      if (r.ok) {
        const rows = (await r.json()) as Array<{ id: string; name?: string }>;
        setProjects(rows.map((p) => ({ id: p.id, name: p.name || "Untitled" })));
      }
    });
  }, [open]);

  // Apply presets only on the open transition (false → true). Running this on
  // every render would clobber the user's in-progress edits whenever the
  // parent re-renders with the same stable preset props (ADD-005).
  React.useEffect(() => {
    const justOpened = open && !prevOpen.current;
    prevOpen.current = open;
    if (!justOpened) return;
    if (presetPropertyId) setPropertyId(presetPropertyId);
    if (presetProjectId) setProjectId(presetProjectId);
  }, [open, presetPropertyId, presetProjectId]);

  // Edit mode: load the existing task on open. Status, work orders, project
  // membership, and notifications are managed elsewhere — this form covers
  // the same fields as the create flow.
  React.useEffect(() => {
    if (!open || !editingId) return;
    let cancelled = false;
    fetch(`/api/pm/tasks/${editingId}`).then(async (r) => {
      if (!r.ok || cancelled) return;
      const t = (await r.json()) as {
        title: string;
        taskType: TaskType;
        priority: WorkPriority;
        dueDate: string | null;
        propertyId: string | null;
        sourceTenantId: string | null;
        sourceOwnerId: string | null;
        description: string;
        projectIds: string[];
      };
      if (cancelled) return;
      setTitle(t.title);
      setTaskType(t.taskType);
      setPriority(t.priority);
      setDueDate(t.dueDate ? t.dueDate.slice(0, 10) : "");
      setPropertyId(t.propertyId ?? "");
      setSourceTenantId(t.sourceTenantId ?? "");
      setSourceOwnerId(t.sourceOwnerId ?? "");
      setDescription(t.description ?? "");
      setProjectId(t.projectIds?.[0] ?? "");
      setProjectIds(t.projectIds ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, editingId]);

  function reset() {
    setTitle("");
    setTaskType("To do");
    setPriority("Normal");
    setDueDate("");
    setPropertyId(presetPropertyId ?? "");
    setSourceTenantId("");
    setSourceOwnerId("");
    setDescription("");
    setProjectId(presetProjectId ?? "");
    setProjectIds([]);
  }

  async function save() {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "error" });
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      taskType,
      priority,
      description: description.trim() || undefined,
    };
    if (dueDate) payload.dueDate = new Date(dueDate).toISOString();
    if (propertyId) payload.propertyId = propertyId;
    if (taskType === "Resident request") {
      payload.sourceTenantId = sourceTenantId || null;
    }
    if (taskType === "Rental owner request") {
      payload.sourceOwnerId = sourceOwnerId || null;
    }
    if (isEdit) {
      // The picker only edits the first project link, but the task may belong
      // to several projects. Replace just the first slot and round-trip the
      // rest so other links aren't dropped (ADD-013).
      const others = projectIds.filter((pid) => pid !== (projectIds[0] ?? ""));
      payload.projectIds = projectId
        ? [projectId, ...others.filter((pid) => pid !== projectId)]
        : others;
      payload.dueDate = dueDate ? new Date(dueDate).toISOString() : null;
      payload.propertyId = propertyId || null;
    } else if (projectId) {
      payload.projectIds = [projectId];
    }

    const url = isEdit ? `/api/pm/tasks/${editingId}` : "/api/pm/tasks";
    const method = isEdit ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setSaving(false);
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Failed",
        description: err.error,
        variant: "error",
      });
      return;
    }
    const created = isEdit
      ? { id: editingId as string }
      : ((await res.json()) as { id: string; taskId: number });
    reset();
    setSaving(false);
    toast({
      title: isEdit ? "Task updated" : "Task created",
      variant: "success",
    });
    onClose();
    await onSaved(created.id);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={isEdit ? "Edit task" : "Add task"}
          description={
            isEdit
              ? "Update task details. Status, assignees, and work orders are managed from the detail page."
              : "Create a new task and assign it from the detail page."
          }
          onClose={onClose}
        />

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Replace HVAC filter"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-type">Type</Label>
              <select
                id="task-type"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as TaskType)}
              >
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <select
                id="task-priority"
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
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-property">Property</Label>
              <select
                id="task-property"
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
          </div>

          {taskType === "Resident request" && (
            <div className="space-y-1.5">
              <Label htmlFor="task-source-tenant">Source tenant</Label>
              <select
                id="task-source-tenant"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={sourceTenantId}
                onChange={(e) => setSourceTenantId(e.target.value)}
              >
                <option value="">— None —</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}
          {taskType === "Rental owner request" && (
            <div className="space-y-1.5">
              <Label htmlFor="task-source-owner">Source owner</Label>
              <select
                id="task-source-owner"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={sourceOwnerId}
                onChange={(e) => setSourceOwnerId(e.target.value)}
              >
                <option value="">— None —</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="task-project">Project (optional)</Label>
            <select
              id="task-project"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— None —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-description">Description</Label>
            <textarea
              id="task-description"
              className="min-h-[80px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              maxLength={4000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context, scope, vendor instructions…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save changes"
                : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
