// AddProjectTasksModal — attaches existing Tasks to a Project (Phase 5
// [G-B-31]). Calls POST /api/pm/projects/[id]/tasks, which keeps both
// Task.projectIds[] and Project.tasks[] in sync.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

interface TaskRow {
  id: string;
  taskId: number;
  title: string;
  status: string;
}

export interface AddProjectTasksModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  projectId: string;
  /** Task ids already attached — hidden from the picker. */
  excludeIds?: string[];
}

export function AddProjectTasksModal({
  open,
  onClose,
  onSaved,
  projectId,
  excludeIds = [],
}: AddProjectTasksModalProps) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<TaskRow[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Reset picker state when the modal closes so the next open starts clean.
  React.useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
    }
  }, [open]);

  // `excludeIds` is a fresh array on every parent render, so depending on it
  // directly re-fires the fetch on each render. Collapse it to a stable string
  // key (sorted join) and depend on that instead (ADD-015).
  const excludeKey = React.useMemo(
    () => [...excludeIds].sort().join(","),
    [excludeIds],
  );

  // Debounce the search so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = React.useState(search);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const params = new URLSearchParams({ includeTerminal: "0" });
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    fetch(`/api/pm/tasks?${params.toString()}`).then(async (r) => {
      if (!r.ok || cancelled) return;
      const data = (await r.json()) as TaskRow[];
      const exclude = new Set(excludeKey ? excludeKey.split(",") : []);
      setRows(data.filter((t) => !exclude.has(t.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch, excludeKey]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function save() {
    if (selected.size === 0) {
      toast({ title: "Pick at least one task", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/pm/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: Array.from(selected) }),
    });
    if (!res.ok) {
      setSaving(false);
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    setSelected(new Set());
    setSaving(false);
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader
          title="Add tasks to project"
          description="Pick from open tasks in this organization."
          onClose={onClose}
        />

        <div className="space-y-3">
          <Input
            placeholder="Search by title"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-[400px] overflow-y-auto rounded-md border border-border">
            {rows.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">No matching tasks.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                    <span className="font-mono text-fg-muted">
                      #{r.taskId}
                    </span>
                    <span className="flex-1 truncate">{r.title}</span>
                    <span className="text-xs text-fg-muted">{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || selected.size === 0}>
            {saving ? "Attaching…" : `Attach ${selected.size || ""} task(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
