// /properties/accounting/bills/[id] — detail page (PDR §3.21).
// 5-tab strip: Summary | Lines | Communications | Files | Notes.
"use client";

import * as React from "react";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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

interface BillLine {
  accountId: string;
  description: string;
  amount: number;
}
interface BillDetail {
  id: string;
  vendorId: string | null;
  dueDate: string;
  status: string;
  memo: string;
  refNo: string;
  amount: number;
  scope: { type: string; id: string | null } | null;
  unitId: string | null;
  lines: BillLine[];
  paidDate: string | null;
  approverUserIds: string[];
  journalEntryId: string | null;
  attachmentFileId: string | null;
  createdBy: string;
  workOrderId: string | null;
}

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<BillDetail | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/bills/${id}`);
    if (r.ok) setDoc((await r.json()) as BillDetail);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function post() {
    if (!doc) return;
    const res = await fetch(`/api/pm/bills/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Due" }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Post failed",
        description: err.error,
        variant: "error",
      });
      return;
    }
    toast({ title: "Bill posted", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/accounting/bills")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Bills
        </Button>
        {doc.status === "Draft" && (
          <Button size="sm" onClick={post}>
            Post bill
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Bill ${(doc.amount / 100).toFixed(2)} —{" "}
            <span className="text-fg-muted">{doc.status}</span>
          </CardTitle>
          <div className="text-xs text-fg-muted">
            Due {new Date(doc.dueDate).toLocaleDateString()} · Source: {doc.createdBy}
            {doc.refNo && ` · Ref: ${doc.refNo}`}
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="lines">Lines</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Memo</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-line text-sm text-fg">
              {doc.memo || "—"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Posting</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Scope"
                  value={
                    doc.scope ? `${doc.scope.type} ${doc.scope.id ?? ""}` : "—"
                  }
                />
                <Field
                  label="Journal entry"
                  value={doc.journalEntryId || "—"}
                />
                <Field label="Work order" value={doc.workOrderId || "—"} />
                <Field
                  label="Paid date"
                  value={
                    doc.paidDate
                      ? new Date(doc.paidDate).toLocaleDateString()
                      : "—"
                  }
                />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lines" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Bill lines</CardTitle>
            </CardHeader>
            <CardContent>
              {doc.lines.length === 0 ? (
                <p className="text-sm text-fg-muted">No lines yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Account</th>
                      <th>Description</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="py-2 text-fg-muted">{l.accountId}</td>
                        <td className="text-fg">{l.description}</td>
                        <td className="tabular-nums font-bold text-fg">
                          ${(l.amount / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} className="py-2 text-right text-xs uppercase tracking-widest text-fg-muted">
                        Total
                      </td>
                      <td className="tabular-nums font-bold text-fg">
                        ${(doc.amount / 100).toFixed(2)}
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
            title="Bill communications"
            description="Vendor email thread on this bill lands in Phase 6 Communications."
          />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="Bill" locationId={doc.id} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="Bill" parentId={doc.id} />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Event history</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityLog parentType="Bill" parentId={doc.id} />
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
