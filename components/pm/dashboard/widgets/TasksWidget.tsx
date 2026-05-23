"use client";

// Tasks widget — Dashboard (PROPERTY_TODO.md Phase 10). Two tabs:
//   "Incoming requests" — searchOption=new
//   "Assigned to me"    — searchOption=me
// Both windowed to the last 30 days via client-side filter on updatedAt.
import * as React from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { WidgetCard } from "../WidgetCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TaskRow {
  id: string;
  taskId: number;
  title: string;
  status: string;
  priority: string;
  updatedAt: string;
  taskType: string;
  propertyId: string | null;
  unitId: string | null;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function fetchTasks(option: "new" | "me"): Promise<TaskRow[]> {
  return fetch(`/api/pm/tasks?searchOption=${option}`)
    .then((r) => (r.ok ? r.json() : []))
    .then((d) => (Array.isArray(d) ? (d as TaskRow[]) : []))
    .catch(() => []);
}

export function TasksWidget() {
  const [tab, setTab] = React.useState<"new" | "me">("new");
  const [rows, setRows] = React.useState<TaskRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetchTasks(tab).then((d) => {
      if (cancelled) return;
      const cutoff = Date.now() - THIRTY_DAYS_MS;
      setRows(
        d.filter((r) => new Date(r.updatedAt).getTime() >= cutoff).slice(0, 3),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const total = rows?.length ?? 0;

  return (
    <WidgetCard
      title="Tasks"
      tabs={
        <Tabs value={tab} onValueChange={(v) => setTab(v as "new" | "me")}>
          <TabsList>
            <TabsTrigger value="new">Incoming</TabsTrigger>
            <TabsTrigger value="me">Assigned to me</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      viewAllHref="/properties/tasks"
      viewAllParams={{ searchOption: tab }}
      footer={total > 0 ? `Showing ${total} in last month` : null}
    >
      {rows == null ? null : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No {tab === "new" ? "incoming" : "assigned"} tasks in the last month.
        </p>
      ) : (
        <ul className="flex flex-1 flex-col divide-y divide-border/60 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="space-y-1 py-2">
              <Link
                href={`/properties/tasks/${t.id}`}
                className="font-semibold text-fg hover:text-primary"
              >
                {t.title}
              </Link>
              <p className="text-xs text-fg-muted">
                {formatDistanceToNowStrict(new Date(t.updatedAt), {
                  addSuffix: true,
                })}
                {" · "}
                {t.taskType}
              </p>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export default TasksWidget;
