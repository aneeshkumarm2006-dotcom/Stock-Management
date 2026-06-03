// /properties/tasks/[id] — Task detail page (PDR §3.13, Phase 5).
// 5-tab strip following the Vendor/WorkOrder convention ([G-B-27]):
//   Summary | Workflow | Communications | Files | Notes
//
// Status transitions:
//   - PMs can manually advance status via the action buttons.
//   - [G-B-33] — moving status → Completed is blocked if any child WO is
//     still open. The API enforces the same.
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
import { ActivityLog } from "@/components/pm/ActivityLog";
import { NotesPanel } from "@/components/pm/NotesPanel";
import { FilesPanel } from "@/components/pm/FilesPanel";
import { CommunicationsTab } from "@/components/pm/CommunicationsTab";
import { AddWorkOrderModal } from "@/components/pm/AddWorkOrderModal";
import { AddTaskModal } from "@/components/pm/AddTaskModal";
import { EditEntityButton } from "@/components/pm/EditEntityButton";
import { RequestOwnerContributionModal } from "@/components/pm/RequestOwnerContributionModal";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { useToast } from "@/components/ui/toast";

interface TaskDetail {
  id: string;
  taskId: number;
  title: string;
  taskType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  pastDue: boolean;
  categoryId: string | null;
  propertyId: string | null;
  unitId: string | null;
  vendors: string[];
  assignees: string[];
  collaborators: string[];
  sourceTenantId: string | null;
  sourceOwnerId: string | null;
  sourceContactId: string | null;
  description: string;
  workOrders: string[];
  projectIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface WoSummary {
  id: string;
  subject: string;
  status: string;
  billTotal: number;
}
interface ProjectRef {
  id: string;
  name: string;
}
interface OcrLink {
  id: string;
  status: string;
  requestedAmount: number;
  receivedAmount: number;
  dueDate: string;
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<TaskDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [wos, setWos] = React.useState<WoSummary[]>([]);
  const [projects, setProjects] = React.useState<ProjectRef[]>([]);
  const [woModalOpen, setWoModalOpen] = React.useState(false);
  const [ocrLinks, setOcrLinks] = React.useState<OcrLink[]>([]);
  const [ocrModalOpen, setOcrModalOpen] = React.useState(false);
  const [editTaskOpen, setEditTaskOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/tasks/${id}`);
    if (r.ok) {
      const d = (await r.json()) as TaskDetail;
      setDoc(d);
      // Load child WO summaries (Workflow tab).
      if (d.workOrders.length > 0) {
        const summaries = await Promise.all(
          d.workOrders.map(async (woId) => {
            const w = await fetch(`/api/pm/work-orders/${woId}`);
            if (!w.ok) return null;
            const wd = (await w.json()) as {
              id: string;
              subject: string;
              status: string;
              billTotal: number;
            };
            return wd;
          }),
        );
        setWos(summaries.filter(Boolean) as WoSummary[]);
      } else {
        setWos([]);
      }
      // Phase 9 — load any OwnerContributionRequest cross-linked to
      // this task. Quiet on 404 / empty — most tasks won't have one.
      const ocrRes = await fetch(
        `/api/pm/owner-contribution-requests?taskId=${d.id}`,
      );
      if (ocrRes.ok) {
        setOcrLinks((await ocrRes.json()) as OcrLink[]);
      } else {
        setOcrLinks([]);
      }
      // Load project names for the chips.
      if (d.projectIds.length > 0) {
        const projects = await Promise.all(
          d.projectIds.map(async (pid) => {
            const p = await fetch(`/api/pm/projects/${pid}`);
            if (!p.ok) return null;
            const pd = (await p.json()) as { id: string; name?: string };
            return { id: pd.id, name: pd.name || "Untitled" };
          }),
        );
        setProjects(projects.filter(Boolean) as ProjectRef[]);
      } else {
        setProjects([]);
      }
    }
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function updateStatus(status: string) {
    if (!doc || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pm/tasks/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Status update failed",
          description: err.error,
          variant: "error",
        });
        return;
      }
      toast({ title: `Status → ${status}`, variant: "success" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/tasks")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Tasks
        </Button>
        <div className="flex gap-2">
          {doc.status !== "Closed" &&
            doc.status !== "Completed" &&
            doc.status !== "Cancelled" && (
              <EditEntityButton
                variant="header"
                onClick={() => setEditTaskOpen(true)}
              />
            )}
          {doc.status === "New" && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => updateStatus("In progress")}
            >
              Start
            </Button>
          )}
          {doc.status === "In progress" && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => updateStatus("Completed")}
            >
              Mark complete
            </Button>
          )}
          {doc.status !== "Closed" && doc.status !== "Completed" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => updateStatus("Cancelled")}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="font-mono text-sm text-fg-muted">
              #{doc.taskId}
            </span>{" "}
            {doc.title}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusPill status={doc.status} />
            <PriorityChip priority={doc.priority} />
            <span className="rounded bg-surface-high px-1.5 py-0.5 text-fg-muted">
              {doc.taskType}
            </span>
            {doc.dueDate && (
              <span
                className={
                  doc.pastDue ? "text-error font-bold" : "text-fg-muted"
                }
              >
                Due {new Date(doc.dueDate).toLocaleDateString()}
              </span>
            )}
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/properties/projects/${p.id}`}
                className="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary hover:underline"
              >
                {p.name}
              </Link>
            ))}
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="workflow">
            Workflow ({wos.length})
          </TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Property"
                  value={
                    doc.propertyId ? (
                      <Link
                        href={`/properties/rentals/properties/${doc.propertyId}`}
                        className="hover:underline"
                      >
                        View property →
                      </Link>
                    ) : (
                      "—"
                    )
                  }
                />
                <Field
                  label="Unit"
                  value={doc.unitId ? doc.unitId : "—"}
                />
                <Field
                  label="Source"
                  value={
                    doc.sourceTenantId
                      ? `Tenant ${doc.sourceTenantId}`
                      : doc.sourceOwnerId
                        ? `Owner ${doc.sourceOwnerId}`
                        : doc.sourceContactId
                          ? `Contact ${doc.sourceContactId}`
                          : "—"
                  }
                />
                <Field
                  label="Assignees"
                  value={doc.assignees.length || "—"}
                />
                <Field
                  label="Collaborators"
                  value={doc.collaborators.length || "—"}
                />
                <Field
                  label="Vendors"
                  value={doc.vendors.length || "—"}
                />
              </dl>
              {doc.description && (
                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-fg-muted">
                    Description
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg">
                    {doc.description}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Owner contributions ({ocrLinks.length})
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOcrModalOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Request owner contribution
              </Button>
            </CardHeader>
            <CardContent>
              {ocrLinks.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No contribution requests linked to this task.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Status</th>
                      <th>Due</th>
                      <th className="text-right">Requested</th>
                      <th className="text-right">Received</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {ocrLinks.map((o) => (
                      <tr key={o.id} className="border-b border-border/40">
                        <td className="py-1">{o.status}</td>
                        <td>{new Date(o.dueDate).toISOString().slice(0, 10)}</td>
                        <td className="text-right tabular-nums">
                          <CurrencyAmount cents={o.requestedAmount} />
                        </td>
                        <td className="text-right tabular-nums">
                          <CurrencyAmount cents={o.receivedAmount} />
                        </td>
                        <td className="text-right">
                          <Link
                            href="/properties/accounting/bills/owner-contributions"
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Event history</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityLog parentType="Task" parentId={doc.id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflow" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Work orders</CardTitle>
              <Button size="sm" onClick={() => setWoModalOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add work order
              </Button>
            </CardHeader>
            <CardContent>
              {wos.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No work orders linked yet.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Subject</th>
                      <th>Status</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wos.map((w) => (
                      <tr key={w.id} className="border-b border-border/40">
                        <td className="py-2">
                          <Link
                            href={`/properties/maintenance/work-orders/${w.id}`}
                            className="font-medium hover:underline"
                          >
                            {w.subject}
                          </Link>
                        </td>
                        <td className="text-fg-muted">{w.status}</td>
                        <td className="tabular-nums text-fg">
                          ${(w.billTotal / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <CommunicationsTab relatedEntityType="Task" relatedEntityId={doc.id} />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="Task" locationId={doc.id} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="Task" parentId={doc.id} />
        </TabsContent>
      </Tabs>

      <AddWorkOrderModal
        open={woModalOpen}
        onClose={() => setWoModalOpen(false)}
        onSaved={async () => {
          await load();
          toast({ title: "Work order created", variant: "success" });
        }}
        presetTaskId={doc.id}
      />

      <RequestOwnerContributionModal
        open={ocrModalOpen}
        onClose={() => setOcrModalOpen(false)}
        onSaved={async () => {
          setOcrModalOpen(false);
          await load();
          toast({ title: "Contribution request created", variant: "success" });
        }}
        taskId={doc.id}
      />

      <AddTaskModal
        open={editTaskOpen}
        onClose={() => setEditTaskOpen(false)}
        editingId={doc.id}
        onSaved={async () => {
          await load();
        }}
      />
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-widest text-fg-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-fg">{value}</dd>
    </div>
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
