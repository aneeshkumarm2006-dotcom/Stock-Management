// /properties/leasing/prospects/[id] — Prospect detail + convert-to-applicant.
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ActivityLog } from "@/components/pm/ActivityLog";
import { NotesPanel } from "@/components/pm/NotesPanel";
import { FilesPanel } from "@/components/pm/FilesPanel";
import { ProspectFormModal } from "@/components/pm/ProspectFormModal";
import type { ProspectStatus } from "@/types/pm";

interface ProspectDetail {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  status: ProspectStatus;
  propertyId: string | null;
  movingDate: string | null;
  beds: number | null;
  notes: string;
  convertedToApplicantId: string | null;
  convertedAt: string | null;
}

export default function ProspectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = React.useState<ProspectDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [converting, setConverting] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/prospects/${params.id}`);
    if (r.status === 404) {
      notFound();
      return;
    }
    if (r.ok) setData((await r.json()) as ProspectDetail);
    setLoading(false);
  }, [params.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) return <div className="p-4 text-fg-muted">Loading…</div>;

  async function convert() {
    setConverting(true);
    const res = await fetch(
      `/api/pm/prospects/${data!.id}/convert-to-applicant`,
      { method: "POST" },
    );
    setConverting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Conversion failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    const result = (await res.json()) as { applicantId: string };
    toast({ title: "Converted to applicant" });
    router.push(`/properties/leasing/applicants/${result.applicantId}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/properties/leasing/prospects">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Prospects
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">{data.displayName}</h1>
        <Badge variant={data.status === "Converted" ? "gain" : "muted"}>
          {data.status}
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            onClick={convert}
            disabled={data.status === "Converted" || converting}
          >
            {data.status === "Converted"
              ? "Already converted"
              : converting
                ? "Converting…"
                : "Convert to applicant"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-fg-muted">Email</div>
                <div>{data.email || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Phone</div>
                <div>{data.phone || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Moving date</div>
                <div>
                  {data.movingDate
                    ? new Date(data.movingDate).toLocaleDateString()
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Beds wanted</div>
                <div>{data.beds ?? "—"}</div>
              </div>
              {data.notes && (
                <div className="col-span-2">
                  <div className="text-xs text-fg-muted">Notes</div>
                  <p className="whitespace-pre-line">{data.notes}</p>
                </div>
              )}
              {data.convertedToApplicantId && (
                <div className="col-span-2">
                  <div className="text-xs text-fg-muted">Converted to</div>
                  <Link
                    href={`/properties/leasing/applicants/${data.convertedToApplicantId}`}
                    className="hover:underline"
                  >
                    Applicant ↗
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <NotesPanel parentType="Prospect" parentId={data.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
            </CardHeader>
            <CardContent>
              <FilesPanel locationType="Prospect" locationId={data.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Event history</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityLog parentType="Prospect" parentId={data.id} />
            </CardContent>
          </Card>
        </div>
      </div>

      <ProspectFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
        existing={{
          id: data.id,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          status: data.status,
          propertyId: data.propertyId,
          movingDate: data.movingDate,
          beds: data.beds,
          notes: data.notes,
        }}
      />
    </div>
  );
}
