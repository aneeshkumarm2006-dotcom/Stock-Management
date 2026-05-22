// /properties/tasks/recurring — RecurringTask list (PDR §3.14, Phase 5).
// The cadence engine (lib/pm/recurringTaskPoster.ts) spawns a fresh Task
// each time nextDate is reached; this page is the editor surface.
"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { AddRecurringTaskModal } from "@/components/pm/AddRecurringTaskModal";

interface Row {
  id: string;
  title: string;
  taskType: string;
  cadence: string;
  nextDate: string;
  priority: string;
  duration: string;
  occurrenceCount: number | null;
  remainingOccurrences: number | null;
  active: boolean;
  postedCount: number;
  lastPostedDate: string | null;
  propertyId: string | null;
}

export default function RecurringTasksPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [includeInactive, setIncludeInactive] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (includeInactive) qs.set("includeInactive", "1");
    const r = await fetch(`/api/pm/recurring-tasks?${qs.toString()}`);
    if (r.ok) setRows((await r.json()) as Row[]);
    setLoading(false);
  }, [includeInactive]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function deactivate(id: string) {
    const r = await fetch(`/api/pm/recurring-tasks/${id}`, {
      method: "DELETE",
    });
    if (r.ok) {
      await load();
      toast({ title: "Recurring task deactivated", variant: "success" });
    } else {
      toast({ title: "Failed to deactivate", variant: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Recurring tasks</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add recurring task
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Show inactive
          </label>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Title</th>
                <th>Type</th>
                <th>Cadence</th>
                <th>Next date</th>
                <th>Last posted</th>
                <th>Posted</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-fg-muted">
                    No recurring tasks yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="py-2 text-fg">{r.title}</td>
                  <td className="text-fg-muted">{r.taskType}</td>
                  <td className="text-fg-muted">{r.cadence}</td>
                  <td className="text-fg-muted">
                    {new Date(r.nextDate).toLocaleDateString()}
                  </td>
                  <td className="text-fg-muted">
                    {r.lastPostedDate
                      ? new Date(r.lastPostedDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="tabular-nums text-fg-muted">
                    {r.postedCount}
                    {r.occurrenceCount !== null
                      ? ` / ${r.occurrenceCount}`
                      : ""}
                  </td>
                  <td>
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase " +
                        (r.active
                          ? "bg-success/10 text-success"
                          : "bg-surface-high text-fg-muted")
                      }
                    >
                      {r.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="text-right">
                    {r.active && (
                      <button
                        type="button"
                        onClick={() => deactivate(r.id)}
                        className="text-xs text-fg-muted hover:text-error"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AddRecurringTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          await load();
          toast({ title: "Recurring task created", variant: "success" });
        }}
      />
    </div>
  );
}
