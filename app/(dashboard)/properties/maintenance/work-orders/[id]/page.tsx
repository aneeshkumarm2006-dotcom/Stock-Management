// /properties/maintenance/work-orders/[id] — detail page (PDR §3.10).
// Tabs: Summary | Financials | Communications | Files | Notes per [G-B-27].
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
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
import { ComingSoon } from "@/components/pm/ComingSoon";
import { useToast } from "@/components/ui/toast";

interface PartsRow {
  qty: number;
  accountId: string;
  description: string;
  price: number;
  total: number;
}
interface WoDetail {
  id: string;
  subject: string;
  vendorId: string;
  status: string;
  priority: string;
  dueDate: string | null;
  taskId: string;
  taskType: string | null;
  taskCategoryId: string | null;
  assignedToUserId: string;
  collaborators: string[];
  workToBePerformed: string;
  vendorNotes: string;
  entryDetails: string | null;
  entryContacts: string[];
  files: string[];
  invoiceNumber: string;
  chargeWorkTo: { type: string; id: string } | null;
  partsAndLabor: PartsRow[];
  billTotal: number;
  billStatus: string;
  unitId: string | null;
  propertyId: string | null;
  updatedAt: string;
}

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<WoDetail | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/work-orders/${id}`);
    if (r.ok) setDoc((await r.json()) as WoDetail);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function updateStatus(status: string) {
    if (!doc) return;
    const res = await fetch(`/api/pm/work-orders/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast({ title: "Status update failed", variant: "error" });
      return;
    }
    toast({ title: `Status → ${status}`, variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/maintenance/work-orders")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Work orders
        </Button>
        <div className="flex gap-2">
          <Link
            href={`/properties/maintenance/work-orders/${doc.id}/print`}
            target="_blank"
          >
            <Button variant="outline" size="sm">
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </Link>
          {doc.status === "New" && (
            <Button size="sm" onClick={() => updateStatus("In progress")}>
              Start work
            </Button>
          )}
          {doc.status === "In progress" && (
            <Button size="sm" onClick={() => updateStatus("Completed")}>
              Mark complete
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{doc.subject}</CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-info/10 px-1.5 py-0.5 font-bold uppercase text-info">
              {doc.status}
            </span>
            <span className="rounded bg-warning/10 px-1.5 py-0.5 font-bold uppercase text-warning">
              {doc.priority}
            </span>
            <span className="text-fg-muted">
              Bill: {doc.billStatus} · ${(doc.billTotal / 100).toFixed(2)}
            </span>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field label="Due date" value={doc.dueDate ? new Date(doc.dueDate).toLocaleDateString() : "—"} />
                <Field label="Entry details" value={doc.entryDetails ?? "—"} />
                <Field label="Invoice number" value={doc.invoiceNumber || "—"} />
                <Field
                  label="Charge work to"
                  value={
                    doc.chargeWorkTo
                      ? `${doc.chargeWorkTo.type} · ${doc.chargeWorkTo.id}`
                      : "—"
                  }
                />
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Work to be performed</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-line text-sm text-fg">
              {doc.workToBePerformed || "—"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Notes to vendor</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-line text-sm text-fg">
              {doc.vendorNotes || "—"}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financials" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Parts and labor</CardTitle>
            </CardHeader>
            <CardContent>
              {doc.partsAndLabor.length === 0 ? (
                <p className="text-sm text-fg-muted">No parts or labor rows yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Qty</th>
                      <th>Account</th>
                      <th>Description</th>
                      <th>Price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.partsAndLabor.map((p, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="py-2 tabular-nums">{p.qty}</td>
                        <td className="text-fg-muted">{p.accountId}</td>
                        <td className="text-fg">{p.description}</td>
                        <td className="tabular-nums">
                          ${(p.price / 100).toFixed(2)}
                        </td>
                        <td className="tabular-nums font-bold text-fg">
                          ${(p.total / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="py-2 text-right text-xs uppercase tracking-widest text-fg-muted">
                        Bill total
                      </td>
                      <td className="tabular-nums font-bold text-fg">
                        ${(doc.billTotal / 100).toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <ComingSoon
            title="Work order communications"
            description="Email + activity stream lands in Phase 6 alongside the EmailMessage entity."
          />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="WorkOrder" locationId={doc.id} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="WorkOrder" parentId={doc.id} />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Event history</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityLog parentType="WorkOrder" parentId={doc.id} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg">{value}</dd>
    </div>
  );
}
