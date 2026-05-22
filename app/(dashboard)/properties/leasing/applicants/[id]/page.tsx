// /properties/leasing/applicants/[id] — Applicant detail with tabs.
// Tabs: Summary | Application | Screening | Event history.
// Move-in CTA gated by [G-B-4] preconditions (server enforces).
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
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
import { ChecklistItemToggle } from "@/components/pm/ChecklistItemToggle";
import {
  APPLICANT_STATUSES,
  APPLICANT_SCREENING_STATUSES,
  type ApplicantStatus,
  type ApplicantScreeningStatus,
} from "@/types/pm";

interface ChecklistItem {
  id: string;
  stage: 1 | 2 | 3;
  label: string;
  checked: boolean;
  checkedAt: string | null;
  systemChecked: boolean;
}

interface ApplicantDetail {
  id: string;
  applicationNumber: number;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phones: Array<{ number: string; label?: string }>;
  status: ApplicantStatus;
  screeningStatus: ApplicantScreeningStatus;
  applicationReceivedAt: string;
  applicantAddress: Record<string, string>;
  applicantBirthDate: string | null;
  applicantSsnLast4: string;
  canRevealSsn: boolean;
  rentalHistory: unknown[];
  employment: unknown[];
  checklist: ChecklistItem[];
  checklistCheckedCount: number;
  checklistTotal: number;
  checklistOverallPct: number;
  emailLinkToOnlineApplication: boolean;
  propertyId: string | null;
  unitId: string | null;
  promotedToTenantId: string | null;
  promotedAt: string | null;
  sourceProspectId: string | null;
}

export default function ApplicantDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = React.useState<ApplicantDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [revealSsn, setRevealSsn] = React.useState(false);
  const [moving, setMoving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(
      `/api/pm/applicants/${params.id}${revealSsn ? "?reveal=ssn4" : ""}`,
    );
    if (r.status === 404) {
      notFound();
      return;
    }
    if (r.ok) setData((await r.json()) as ApplicantDetail);
    setLoading(false);
  }, [params.id, revealSsn]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) return <div className="p-4 text-fg-muted">Loading…</div>;

  const stage1 = data.checklist.filter((i) => i.stage === 1);
  const stage2 = data.checklist.filter((i) => i.stage === 2);
  const stage3 = data.checklist.filter((i) => i.stage === 3);

  const moveInReady =
    data.status === "Approved" &&
    Boolean(data.email) &&
    Boolean(data.propertyId) &&
    Boolean(data.unitId) &&
    stage1.every((i) => i.checked);

  async function setStatus(next: ApplicantStatus) {
    const res = await fetch(`/api/pm/applicants/${data!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      toast({ title: "Status update failed", variant: "error" });
      return;
    }
    toast({ title: `Status → ${next}` });
    await load();
  }

  async function setScreening(next: ApplicantScreeningStatus) {
    const res = await fetch(`/api/pm/applicants/${data!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ screeningStatus: next }),
    });
    if (!res.ok) {
      toast({ title: "Screening update failed", variant: "error" });
      return;
    }
    toast({ title: `Screening → ${next}` });
    await load();
  }

  async function convertToTenant() {
    setMoving(true);
    const res = await fetch(
      `/api/pm/applicants/${data!.id}/convert-to-tenant`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    setMoving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Move-in failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    const result = (await res.json()) as { tenantId: string };
    toast({ title: "Tenant created from applicant" });
    router.push(`/properties/rentals/tenants/${result.tenantId}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/properties/leasing/applicants">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Applicants
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">
          #{data.applicationNumber} · {data.displayName}
        </h1>
        <Badge variant={data.status === "Approved" ? "gain" : "muted"}>
          {data.status}
        </Badge>
        {data.promotedToTenantId && (
          <Badge variant="outline">Promoted to tenant</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <select
            className="rounded border bg-background px-2 py-1.5 text-xs"
            value={data.status}
            onChange={(e) => setStatus(e.target.value as ApplicantStatus)}
          >
            {APPLICANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={convertToTenant}
            disabled={!moveInReady || moving || !!data.promotedToTenantId}
            title={
              data.promotedToTenantId
                ? "Already promoted"
                : !moveInReady
                  ? "Approved status, Stage 1 complete, email + property + unit required ([G-B-4])"
                  : ""
            }
          >
            {data.promotedToTenantId
              ? "Already promoted"
              : moving
                ? "Moving in…"
                : "Move in"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="application">Application</TabsTrigger>
          <TabsTrigger value="screening">Screening</TabsTrigger>
          <TabsTrigger value="history">Event history</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Identity</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-fg-muted">First name</div>
                    <div>{data.firstName}</div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Last name</div>
                    <div>{data.lastName}</div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Email</div>
                    <div>{data.email || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Phones</div>
                    <div>
                      {data.phones.length === 0
                        ? "—"
                        : data.phones
                            .map((p) => p.number)
                            .filter(Boolean)
                            .join(", ")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Birth date</div>
                    <div>
                      {data.applicantBirthDate
                        ? new Date(data.applicantBirthDate).toLocaleDateString()
                        : "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="text-xs text-fg-muted">SSN (last 4)</div>
                      <div className="font-mono">
                        {data.applicantSsnLast4 || "—"}
                      </div>
                    </div>
                    {data.canRevealSsn && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevealSsn((v) => !v)}
                        title={revealSsn ? "Mask SSN" : "Reveal SSN"}
                      >
                        {revealSsn ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <NotesPanel parentType="Applicant" parentId={data.id} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Files</CardTitle>
                </CardHeader>
                <CardContent>
                  <FilesPanel locationType="Applicant" locationId={data.id} />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Checklist</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <div className="mb-2">
                    {data.checklistCheckedCount} / {data.checklistTotal} (
                    {data.checklistOverallPct}%)
                  </div>
                  <div className="text-xs text-fg-muted">
                    Status is independent of checklist progress (BR-LA-6).
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Source</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  {data.sourceProspectId && (
                    <Link
                      href={`/properties/leasing/prospects/${data.sourceProspectId}`}
                      className="hover:underline"
                    >
                      ← Prospect ↗
                    </Link>
                  )}
                  {data.promotedToTenantId && (
                    <Link
                      href={`/properties/rentals/tenants/${data.promotedToTenantId}`}
                      className="hover:underline block"
                    >
                      → Tenant ↗
                    </Link>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="application">
          <Card>
            <CardHeader>
              <CardTitle>14-item checklist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              {data.checklist.some(
                (i) => i.stage === 1 && i.systemChecked && i.checked,
              ) && (
                <div className="rounded border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary">
                  An item was auto-checked by System (BR-LA-7 — self-serve
                  receipt).
                </div>
              )}
              <ChecklistStage
                title="Stage 1 — Application"
                items={stage1}
                applicantId={data.id}
                onChanged={load}
              />
              <ChecklistStage
                title="Stage 2 — Screening"
                items={stage2}
                applicantId={data.id}
                onChanged={load}
              />
              <ChecklistStage
                title="Stage 3 — Move-in"
                items={stage3}
                applicantId={data.id}
                onChanged={load}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="screening">
          <Card>
            <CardHeader>
              <CardTitle>Screening</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">
                TODO Phase 6 — auto-order requires company info to be
                configured (BR-LA-8). Banner + Edit company information link
                will surface here when org settings are incomplete.
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-fg-muted">Screening status</label>
                <select
                  className="rounded border bg-background px-2 py-1.5 text-sm"
                  value={data.screeningStatus}
                  onChange={(e) =>
                    setScreening(e.target.value as ApplicantScreeningStatus)
                  }
                >
                  {APPLICANT_SCREENING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Event history</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityLog parentType="Applicant" parentId={data.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChecklistStage({
  title,
  items,
  applicantId,
  onChanged,
}: {
  title: string;
  items: ChecklistItem[];
  applicantId: string;
  onChanged: () => void | Promise<void>;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="space-y-2">
        {items.map((i) => (
          <ChecklistItemToggle
            key={i.id}
            applicantId={applicantId}
            item={i}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}
