// /properties/leasing/draft-leases/[id] — Draft lease detail.
// Tabs: Summary | Financials | Tenant.
// BR-LL-9 conflict banner when the unit carries an Active/Future lease.
// Buttons: Cancel, Generate offer, Execute.
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ActivityLog } from "@/components/pm/ActivityLog";
import { NotesPanel } from "@/components/pm/NotesPanel";
import { FilesPanel } from "@/components/pm/FilesPanel";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { CancelDraftLeaseDialog } from "@/components/pm/CancelDraftLeaseDialog";

interface DraftLeaseDetail {
  id: string;
  draftId: number;
  executionStatus: string;
  esignatureStatus: string;
  signatureStatus: string;
  propertyId: string;
  unitId: string;
  leaseType: string;
  startDate: string | null;
  endDate: string | null;
  primaryRent: {
    amount: number;
    accountId: string;
    nextDueDate: string | null;
    memo: string;
  };
  securityDeposit: number;
  tenants: Array<{
    tenantId: string | null;
    firstName: string;
    lastName: string;
    email: string;
    isCosigner: boolean;
  }>;
  cosigners: Array<{ tenantId: string | null; firstName: string; lastName: string }>;
  recurringCharges: Array<{
    id: string;
    amount: number;
    frequency: string;
    memo: string;
    nextDate: string | null;
  }>;
  oneTimeCharges: Array<{ id: string; amount: number; memo: string; dueDate: string | null }>;
  moveInCharges: Array<{
    id: string;
    amount: number;
    memo: string;
    dueDate: string | null;
    paidAt: string | null;
  }>;
  approvedApplicants: Array<{
    applicantId: string;
    firstName: string;
    lastName: string;
  }>;
  esignatureDocuments: Array<{
    id: string;
    label: string;
    role: string;
    status: string;
  }>;
  promotedToLeaseId: string | null;
  promotedAt: string | null;
  cancelledAt: string | null;
  conflict: {
    leaseId: string;
    leaseNumber: number;
    status: string;
  } | null;
  canExecute: boolean;
}

export default function DraftLeaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = React.useState<DraftLeaseDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [executing, setExecuting] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/draft-leases/${params.id}`);
    if (r.status === 404) {
      notFound();
      return;
    }
    if (r.ok) setData((await r.json()) as DraftLeaseDetail);
    setLoading(false);
  }, [params.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) return <div className="p-4 text-fg-muted">Loading…</div>;

  async function generateOffer() {
    const res = await fetch(`/api/pm/draft-leases/${data!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        esignatureStatus: "Sent",
        executionStatus: "Out for signature",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Generate offer failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    toast({
      title: "Offer generated",
      description: "TODO Phase 6 — real envelope dispatch.",
    });
    await load();
  }

  async function execute() {
    setExecuting(true);
    const res = await fetch(`/api/pm/draft-leases/${data!.id}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    setExecuting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Execute failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    const result = (await res.json()) as { leaseId: string };
    toast({ title: "Lease executed" });
    router.push(`/properties/rentals/rent-roll/${result.leaseId}`);
  }

  async function markPaid(chargeId: string) {
    // Stand-in for the Applicant Center charge-pay flow (TODO Phase 6).
    // The body PATCH treats moveInCharges as a replace-all; instead we
    // mutate the row locally and PATCH only the array.
    const next = data!.moveInCharges.map((c) =>
      c.id === chargeId
        ? { ...c, paidAt: new Date().toISOString() }
        : c,
    );
    // Server PATCH for moveInCharges accepts a fresh list (no paidAt
    // field server-side — the server resets it to null on PATCH). Simplest
    // for the Phase 3 stub: use the dedicated route below by mutating doc
    // locally for UI, and TODO note real flow.
    void next;
    toast({
      title: "Mark-as-paid is stubbed",
      description:
        "TODO Phase 6 — Applicant Center charge-pay flow. For now use the PATCH route directly.",
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/properties/leasing/draft-leases">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Drafts
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Draft #{data.draftId}</h1>
        <Badge variant="muted">{data.executionStatus}</Badge>
        <Badge variant="outline">eSig: {data.esignatureStatus}</Badge>
        <div className="ml-auto flex gap-2">
          {data.executionStatus === "Draft" && (
            <Button variant="outline" size="sm" onClick={generateOffer}>
              Generate offer
            </Button>
          )}
          {data.executionStatus !== "Executed" &&
            data.executionStatus !== "Cancelled" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCancelOpen(true)}
              >
                Cancel draft
              </Button>
            )}
          <Button
            size="sm"
            onClick={execute}
            disabled={
              !data.canExecute ||
              executing ||
              !!data.promotedToLeaseId ||
              data.executionStatus === "Cancelled"
            }
            title={
              !data.canExecute
                ? "Move executionStatus to Ready to execute and pay every move-in charge (BR-LL-11)"
                : ""
            }
          >
            {executing ? "Executing…" : "Execute lease"}
          </Button>
        </div>
      </div>

      {data.conflict && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700">
          This unit has an {data.conflict.status} lease (#
          {data.conflict.leaseNumber}). —{" "}
          <Link
            href={`/properties/rentals/rent-roll/${data.conflict.leaseId}`}
            className="underline"
          >
            Update existing lease
          </Link>{" "}
          (BR-LL-9).
        </div>
      )}

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="tenant">Tenant</TabsTrigger>
          <TabsTrigger value="history">Event history</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card>
            <CardHeader>
              <CardTitle>Lease terms</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-fg-muted">Lease type</div>
                <div>{data.leaseType}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Dates</div>
                <div>
                  {data.startDate
                    ? new Date(data.startDate).toLocaleDateString()
                    : "—"}{" "}
                  →{" "}
                  {data.endDate
                    ? new Date(data.endDate).toLocaleDateString()
                    : "(At-will)"}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Primary rent</div>
                <div>
                  <CurrencyAmount cents={data.primaryRent.amount} /> / cycle
                </div>
                {data.primaryRent.memo && (
                  <div className="text-xs text-fg-muted">
                    {data.primaryRent.memo}
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs text-fg-muted">Security deposit</div>
                <div>
                  <CurrencyAmount cents={data.securityDeposit} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financials">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Move-in charges (BR-LL-11)</CardTitle>
              </CardHeader>
              <CardContent>
                {data.moveInCharges.length === 0 ? (
                  <p className="text-sm text-fg-muted">
                    No move-in charges defined.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-fg-muted border-b border-border">
                      <tr>
                        <th className="py-1 text-left">Memo</th>
                        <th>Due</th>
                        <th>Amount</th>
                        <th>Paid</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.moveInCharges.map((c) => (
                        <tr key={c.id} className="border-b border-border/40">
                          <td className="py-1">{c.memo || "—"}</td>
                          <td>
                            {c.dueDate
                              ? new Date(c.dueDate).toLocaleDateString()
                              : "—"}
                          </td>
                          <td>
                            <CurrencyAmount cents={c.amount} />
                          </td>
                          <td>
                            {c.paidAt
                              ? new Date(c.paidAt).toLocaleDateString()
                              : (
                                <Badge variant="loss">Unpaid</Badge>
                              )}
                          </td>
                          <td>
                            {!c.paidAt && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => markPaid(c.id)}
                              >
                                Mark paid
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-xs text-fg-muted">
                  All move-in charges must be paid before Execute (BR-LL-11).
                  TODO Phase 6 — Applicant Center pay flow.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recurring charges</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recurringCharges.length === 0 ? (
                  <p className="text-sm text-fg-muted">None.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.recurringCharges.map((c) => (
                      <li key={c.id}>
                        <CurrencyAmount cents={c.amount} /> · {c.frequency}{" "}
                        {c.memo && `· ${c.memo}`}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>eSignature documents</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {data.esignatureDocuments.length === 0 ? (
                  <p className="text-fg-muted">None.</p>
                ) : (
                  data.esignatureDocuments.map((d) => (
                    <div key={d.id} className="flex items-center gap-2">
                      <span>{d.label}</span>
                      <Badge variant="muted">{d.status}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tenant">
          <Card>
            <CardHeader>
              <CardTitle>Tenants & cosigners</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-fg-muted mb-1">Tenants</div>
                {data.tenants.length === 0 ? (
                  <p className="text-fg-muted">None.</p>
                ) : (
                  data.tenants.map((t, i) => (
                    <div key={i}>
                      {t.firstName} {t.lastName}
                      {t.email && (
                        <span className="text-fg-muted"> · {t.email}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div>
                <div className="text-xs text-fg-muted mb-1">
                  Approved applicants
                </div>
                {data.approvedApplicants.length === 0 ? (
                  <p className="text-fg-muted">None.</p>
                ) : (
                  data.approvedApplicants.map((a) => (
                    <Link
                      key={a.applicantId}
                      href={`/properties/leasing/applicants/${a.applicantId}`}
                      className="block hover:underline"
                    >
                      {a.firstName} {a.lastName} ↗
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Event history</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityLog parentType="DraftLease" parentId={data.id} />
                </CardContent>
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <NotesPanel parentType="DraftLease" parentId={data.id} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Files</CardTitle>
                </CardHeader>
                <CardContent>
                  <FilesPanel
                    locationType="DraftLease"
                    locationId={data.id}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <CancelDraftLeaseDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onSaved={load}
        draftLeaseId={data.id}
      />
    </div>
  );
}
