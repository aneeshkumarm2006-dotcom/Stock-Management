// /properties/tasks — full Tasks surface (PDR §3.13, Phase 5).
//
// URL state:
//   ?searchOption=new|me|all   (BR-TP-1)
//   ?tab=tasks|analytics       (sub-tabs under searchOption='all')
//
// Default filters:
//   me:  current user is assignee OR collaborator; non-terminal only (BR-TP-3)
//   all: non-terminal only (BR-TP-2); ?includeTerminal=1 reveals closed
//   new: Incoming list — status='New' only
//
// Past-due red rendering (BR-TP-6) consumes the `pastDue` flag returned by
// /api/pm/tasks.
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ComingSoon } from "@/components/pm/ComingSoon";
import { AddTaskModal } from "@/components/pm/AddTaskModal";
import { EditEntityButton } from "@/components/pm/EditEntityButton";
import { formatDateOnly } from "@/lib/utils/dateInput";

interface TaskRow {
  id: string;
  taskId: number;
  title: string;
  taskType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  pastDue: boolean;
  propertyId: string | null;
  unitId: string | null;
  vendorIds: string[];
  workOrderIds: string[];
  updatedAt: string;
}

type SearchOption = "new" | "me" | "all";

export default function TasksPage() {
  return (
    <React.Suspense fallback={null}>
      <TasksPageInner />
    </React.Suspense>
  );
}

function TasksPageInner() {
  const router = useRouter();
  const params = useSearchParams();

  const initialSearchOption =
    (params.get("searchOption") as SearchOption | null) ?? "all";
  const initialTab = params.get("tab") === "analytics" ? "analytics" : "tasks";
  // Dashboard Overdue widget deep-links here with `?overdue=1` (PROPERTY_TODO.md
  // Phase 10 [G-B-12]). We persist the flag in state so URL sync below
  // round-trips it.
  const initialOverdue = params.get("overdue") === "1";

  const [searchOption, setSearchOption] = React.useState<SearchOption>(
    initialSearchOption,
  );
  const [tab, setTab] = React.useState<"tasks" | "analytics">(initialTab);
  const [includeTerminal, setIncludeTerminal] = React.useState(false);
  const [overdueOnly, setOverdueOnly] = React.useState(initialOverdue);
  const [rows, setRows] = React.useState<TaskRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | undefined>();

  const load = React.useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    qs.set("searchOption", searchOption);
    if (includeTerminal) qs.set("includeTerminal", "1");
    if (search.trim()) qs.set("q", search.trim());
    const r = await fetch(`/api/pm/tasks?${qs.toString()}`);
    if (r.ok) setRows((await r.json()) as TaskRow[]);
    setLoading(false);
  }, [searchOption, includeTerminal, search]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Keep URL in sync so links are shareable.
  React.useEffect(() => {
    const qs = new URLSearchParams();
    qs.set("searchOption", searchOption);
    if (searchOption === "all" && tab === "analytics") qs.set("tab", "analytics");
    if (overdueOnly) qs.set("overdue", "1");
    router.replace(`/properties/tasks?${qs.toString()}`, { scroll: false });
  }, [searchOption, tab, overdueOnly, router]);

  // Live chip counters derive from the loaded set per filter rules.
  const counters = React.useMemo(() => {
    return {
      new: rows.filter((r) => r.status === "New").length,
      me: rows.length, // searchOption=me already filters server-side
      all: rows.length,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(undefined);
              setModalOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add task
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <FilterChip
              label="Incoming"
              count={counters.new}
              selected={searchOption === "new"}
              onClick={() => setSearchOption("new")}
            />
            <FilterChip
              label="My tasks"
              count={counters.me}
              selected={searchOption === "me"}
              onClick={() => setSearchOption("me")}
            />
            <FilterChip
              label="All tasks"
              count={counters.all}
              selected={searchOption === "all"}
              onClick={() => setSearchOption("all")}
            />
            <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={includeTerminal}
                onChange={(e) => setIncludeTerminal(e.target.checked)}
              />
              Include closed
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-loss">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(e) => setOverdueOnly(e.target.checked)}
              />
              Overdue only
            </label>
            <div className="ml-auto w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title"
              />
            </div>
          </div>

          {searchOption === "all" && (
            <div className="flex gap-1 border-b border-border text-sm">
              <TabButton
                label="Tasks"
                selected={tab === "tasks"}
                onClick={() => setTab("tasks")}
              />
              <TabButton
                label="Analytics"
                selected={tab === "analytics"}
                onClick={() => setTab("analytics")}
              />
            </div>
          )}

          {searchOption === "all" && tab === "analytics" ? (
            <ComingSoon title="Tasks Analytics" />
          ) : (
            <TaskTable
              rows={overdueOnly ? rows.filter((r) => r.pastDue) : rows}
              loading={loading}
              onEdit={(id) => {
                setEditingId(id);
                setModalOpen(true);
              }}
            />
          )}
        </CardContent>
      </Card>

      <AddTaskModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingId(undefined);
        }}
        editingId={editingId}
        onSaved={async () => {
          await load();
        }}
      />
    </div>
  );
}

function TaskTable({
  rows,
  loading,
  onEdit,
}: {
  rows: TaskRow[];
  loading: boolean;
  onEdit: (id: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
        <tr>
          <th className="py-2">#</th>
          <th>Title</th>
          <th>Type</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Due</th>
          <th>WOs</th>
          <th />
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
              No tasks match.
            </td>
          </tr>
        )}
        {rows.map((t) => (
          <tr key={t.id} className="border-b border-border/40">
            <td className="py-2 font-mono text-xs text-fg-muted">
              #{t.taskId}
            </td>
            <td className="text-fg">
              <Link
                href={`/properties/tasks/${t.id}`}
                className="font-medium hover:underline"
              >
                {t.title}
              </Link>
            </td>
            <td className="text-fg-muted">{t.taskType}</td>
            <td>
              <StatusPill status={t.status} />
            </td>
            <td>
              <PriorityChip priority={t.priority} />
            </td>
            <td
              className={
                t.pastDue ? "text-error font-bold" : "text-fg-muted"
              }
            >
              {t.dueDate ? formatDateOnly(t.dueDate) : "—"}
            </td>
            <td className="text-fg-muted">
              {t.workOrderIds.length > 0 ? t.workOrderIds.length : "—"}
            </td>
            <td className="text-right">
              <EditEntityButton onClick={() => onEdit(t.id)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors " +
        (selected
          ? "border-primary bg-primary text-primary-fg"
          : "border-border bg-surface text-fg-muted hover:text-fg")
      }
    >
      {label}
      <span
        className={
          "rounded-full px-1.5 text-[10px] " +
          (selected
            ? "bg-primary-fg/20 text-primary-fg"
            : "bg-surface-high text-fg-muted")
        }
      >
        {count}
      </span>
    </button>
  );
}

function TabButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "border-b-2 px-3 py-1.5 text-sm transition-colors " +
        (selected
          ? "border-primary text-fg"
          : "border-transparent text-fg-muted hover:text-fg")
      }
    >
      {label}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    New: "bg-info/10 text-info",
    "In progress": "bg-primary/10 text-primary",
    "On hold": "bg-warning/10 text-warning",
    Completed: "bg-success/10 text-success",
    Closed: "bg-surface-high text-fg-muted",
    Cancelled: "bg-surface-high text-fg-muted",
  };
  const cls = map[status] ?? "bg-surface-high text-fg-muted";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}
    >
      {status}
    </span>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    Low: "bg-surface-high text-fg-muted",
    Normal: "bg-info/10 text-info",
    High: "bg-warning/10 text-warning",
    Urgent: "bg-error/10 text-error",
  };
  const cls = map[priority] ?? "bg-surface-high text-fg-muted";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}
    >
      {priority}
    </span>
  );
}
