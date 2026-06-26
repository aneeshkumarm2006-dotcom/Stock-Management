"use client";

// Overdue Tasks widget — Dashboard (PROPERTY_TODO.md Phase 10). Filters the
// task list by the `pastDue` field already returned by /api/pm/tasks. Two
// tabs: "My overdue" (searchOption=me) vs "All overdue" (searchOption=all).
import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { WidgetCard } from "../WidgetCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseDateOnly } from "@/lib/utils/dateInput";

interface TaskRow {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  pastDue: boolean;
  taskType: string;
}

function fetchTasks(option: "me" | "all"): Promise<TaskRow[]> {
  const params = new URLSearchParams();
  if (option === "me") params.set("searchOption", "me");
  return fetch(`/api/pm/tasks?${params.toString()}`)
    .then((r) => (r.ok ? r.json() : []))
    .then((d) => (Array.isArray(d) ? (d as TaskRow[]) : []))
    .catch(() => []);
}

export function OverdueTasksWidget() {
  const [tab, setTab] = React.useState<"me" | "all">("me");
  const [rows, setRows] = React.useState<TaskRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetchTasks(tab).then((d) => {
      if (cancelled) return;
      setRows(d.filter((t) => t.pastDue));
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const visible = rows?.slice(0, 4) ?? [];
  const total = rows?.length ?? 0;

  return (
    <WidgetCard
      title="Overdue Tasks"
      tabs={
        <Tabs value={tab} onValueChange={(v) => setTab(v as "me" | "all")}>
          <TabsList>
            <TabsTrigger value="me">My overdue</TabsTrigger>
            <TabsTrigger value="all">All overdue</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      viewAllHref="/properties/tasks"
      viewAllParams={{
        searchOption: tab === "me" ? "me" : "all",
        overdue: 1,
      }}
      footer={total > 0 ? `${total} overdue` : null}
    >
      {rows == null ? null : visible.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {tab === "me"
            ? "There are no overdue tasks assigned to you."
            : "There are no overdue tasks."}
        </p>
      ) : (
        <ul className="flex flex-1 flex-col divide-y divide-border/60 text-sm">
          {visible.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 py-2">
              <Link
                href={`/properties/tasks/${t.id}`}
                className="truncate font-semibold text-fg hover:text-primary"
              >
                {t.title}
              </Link>
              {t.dueDate && (
                <span className="shrink-0 text-xs text-loss">
                  Due {format(parseDateOnly(t.dueDate)!, "MMM d")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export default OverdueTasksWidget;
