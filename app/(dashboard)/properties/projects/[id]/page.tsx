// /properties/projects/[id] — Project detail (PDR §3.15, Phase 5).
// Tabs: Summary | Tasks | Files | Notes | Event history. The Tasks tab
// surfaces the M:N linkage editor via AddProjectTasksModal.
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { ActivityLog } from "@/components/pm/ActivityLog";
import { NotesPanel } from "@/components/pm/NotesPanel";
import { FilesPanel } from "@/components/pm/FilesPanel";
import { AddProjectTasksModal } from "@/components/pm/AddProjectTasksModal";

interface ProjectDetail {
  id: string;
  projectTypeId: string;
  propertyId: string;
  projectLeadUserId: string;
  name: string;
  description: string;
  budget: number;
  dueDate: string | null;
  tasks: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskRow {
  id: string;
  taskId: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  pastDue: boolean;
}

interface PropertyLookup {
  id: string;
  propertyName: string;
}
interface ProjectTypeLookup {
  id: string;
  name: string;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<ProjectDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tasks, setTasks] = React.useState<TaskRow[]>([]);
  const [property, setProperty] = React.useState<PropertyLookup | null>(null);
  const [projectType, setProjectType] = React.useState<ProjectTypeLookup | null>(
    null,
  );
  const [addOpen, setAddOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/projects/${id}`);
    if (r.ok) setDoc((await r.json()) as ProjectDetail);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (!doc) return;
    fetch(`/api/pm/tasks?projectId=${doc.id}&includeTerminal=1`).then(
      async (r) => {
        if (r.ok) setTasks((await r.json()) as TaskRow[]);
      },
    );
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) {
        const all = (await r.json()) as PropertyLookup[];
        setProperty(all.find((p) => p.id === doc.propertyId) ?? null);
      }
    });
    fetch("/api/pm/project-types").then(async (r) => {
      if (r.ok) {
        const all = (await r.json()) as ProjectTypeLookup[];
        setProjectType(all.find((p) => p.id === doc.projectTypeId) ?? null);
      }
    });
  }, [doc]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function detachTask(taskId: string) {
    if (!doc) return;
    const res = await fetch(`/api/pm/projects/${doc.id}/tasks`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: [taskId] }),
    });
    if (!res.ok) {
      toast({ title: "Detach failed", variant: "error" });
      return;
    }
    toast({ title: "Task detached", variant: "success" });
    await load();
  }

  async function patchStatus(status: "In progress" | "Closed") {
    if (!doc) return;
    const res = await fetch(`/api/pm/projects/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast({ title: "Status update failed", variant: "error" });
      return;
    }
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/projects")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </Button>
        <div className="flex gap-2">
          {doc.status === "In progress" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => patchStatus("Closed")}
            >
              Close project
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => patchStatus("In progress")}
            >
              Reopen project
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{doc.name || "(unnamed project)"}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusPill status={doc.status} />
            <span className="text-fg-muted">
              Type: {projectType?.name ?? doc.projectTypeId}
            </span>
            <span className="text-fg-muted">
              Property:{" "}
              <Link
                href={`/properties/rentals/properties/${doc.propertyId}`}
                className="hover:underline"
              >
                {property?.propertyName ?? doc.propertyId}
              </Link>
            </span>
            <span className="text-fg-muted">
              Budget: <CurrencyAmount cents={doc.budget} />
            </span>
            {doc.dueDate && (
              <span className="text-fg-muted">
                Due {new Date(doc.dueDate).toLocaleDateString()}
              </span>
            )}
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({doc.tasks.length})</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="events">Event history</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field label="Name" value={doc.name || "—"} />
                <Field
                  label="Status"
                  value={doc.status}
                />
                <Field
                  label="Project lead (user ID)"
                  value={doc.projectLeadUserId}
                />
                <Field
                  label="Property"
                  value={property?.propertyName ?? doc.propertyId}
                />
                <Field
                  label="Project type"
                  value={projectType?.name ?? doc.projectTypeId}
                />
                <Field
                  label="Budget"
                  value={`$${(doc.budget / 100).toFixed(2)}`}
                />
                <Field
                  label="Due date"
                  value={
                    doc.dueDate
                      ? new Date(doc.dueDate).toLocaleDateString()
                      : "—"
                  }
                />
              </dl>
            </CardContent>
          </Card>
          {doc.description && (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-line text-sm text-fg">
                {doc.description}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tasks in this project ({tasks.length})</CardTitle>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add tasks
              </Button>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No tasks linked yet. Attach existing tasks or create new ones.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">#</th>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Due</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id} className="border-b border-border/40">
                        <td className="py-2 font-mono text-xs text-fg-muted">
                          #{t.taskId}
                        </td>
                        <td>
                          <Link
                            href={`/properties/tasks/${t.id}`}
                            className="font-medium text-fg hover:underline"
                          >
                            {t.title}
                          </Link>
                        </td>
                        <td>
                          <StatusPill status={t.status} />
                        </td>
                        <td>
                          <PriorityChip priority={t.priority} />
                        </td>
                        <td
                          className={
                            t.pastDue
                              ? "font-bold text-error"
                              : "text-fg-muted"
                          }
                        >
                          {t.dueDate
                            ? new Date(t.dueDate).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="text-xs text-fg-muted hover:text-error"
                            onClick={() => detachTask(t.id)}
                          >
                            Detach
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="Project" locationId={doc.id} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="Project" parentId={doc.id} />
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <ActivityLog parentType="Project" parentId={doc.id} />
        </TabsContent>
      </Tabs>

      <AddProjectTasksModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          await load();
          toast({ title: "Tasks attached", variant: "success" });
        }}
        projectId={doc.id}
        excludeIds={doc.tasks}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-fg-muted">
        {label}
      </dt>
      <dd className="text-sm text-fg break-all">{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    "In progress": "bg-primary/10 text-primary",
    Closed: "bg-surface-high text-fg-muted",
    New: "bg-info/10 text-info",
    "On hold": "bg-warning/10 text-warning",
    Completed: "bg-success/10 text-success",
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
