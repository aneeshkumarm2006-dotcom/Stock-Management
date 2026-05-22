// /properties/accounting/recurring-transactions — list + edit surface.
// Phase 4 ships the read view plus an Edit modal; Phase 9's full
// RecurringTransaction editor extends this.
"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { EditRecurringCheckModal } from "@/components/pm/EditRecurringCheckModal";

interface RtRow {
  id: string;
  type: string;
  payee: { type: string; id: string } | null;
  frequency: string;
  nextDate: string;
  postNDaysInAdvance: number;
  duration: string;
  occurrenceCount: number | null;
  remainingOccurrences: number | null;
  memo: string;
  active: boolean;
  postedCount: number;
}

export default function RecurringTransactionsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<RtRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/recurring-transactions?includeInactive=1");
    if (r.ok) setRows((await r.json()) as RtRow[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function runCron() {
    const res = await fetch("/api/cron/post-recurring");
    if (!res.ok) {
      toast({ title: "Cron failed", variant: "error" });
      return;
    }
    const data = (await res.json()) as { posted: number; ran: number };
    toast({
      title: `Cron ran (${data.posted}/${data.ran} posted)`,
      variant: "success",
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Recurring transactions</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New rule
            </Button>
            <Button size="sm" variant="outline" onClick={runCron}>
              Run poster now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Type</th>
                <th>Frequency</th>
                <th>Next date</th>
                <th>Posted</th>
                <th>Remaining</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-fg-muted">
                    No recurring rules.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="py-2 text-fg">{r.type}</td>
                  <td className="text-fg-muted">{r.frequency}</td>
                  <td className="text-fg-muted">
                    {new Date(r.nextDate).toLocaleDateString()}
                  </td>
                  <td className="text-fg-muted tabular-nums">{r.postedCount}</td>
                  <td className="text-fg-muted tabular-nums">
                    {r.remainingOccurrences ?? "—"}
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
                      {r.active ? "Active" : "Cancelled"}
                    </span>
                  </td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(r.id)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {creating && (
        <EditRecurringCheckModal
          open={creating}
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {editing && (
        <EditRecurringCheckModal
          open={Boolean(editing)}
          mode="edit"
          recurringId={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
