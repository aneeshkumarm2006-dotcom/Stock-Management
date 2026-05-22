// /properties/leasing/applicants — applicant list view.
// Default filter `(N) New, Screening` per BR-LA — open funnel only.
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { ApplicantFormModal } from "@/components/pm/ApplicantFormModal";
import { APPLICANT_STATUSES, type ApplicantStatus } from "@/types/pm";

interface ApplicantRow {
  id: string;
  applicationNumber: number;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  status: ApplicantStatus;
  screeningStatus: string;
  applicationReceivedAt: string;
  checklistCheckedCount: number;
  checklistTotal: number;
  checklistOverallPct: number;
  promotedToTenantId: string | null;
}

export default function ApplicantsPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<ApplicantRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<ApplicantStatus | "open">(
    "open",
  );
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter === "open") {
      // default behaviour — server filters to New + Screening
    } else {
      params.set("status", statusFilter);
      params.set("includeClosed", "1");
    }
    if (search.trim()) params.set("q", search.trim());
    const r = await fetch(`/api/pm/applicants?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as ApplicantRow[]);
    setLoading(false);
  }, [statusFilter, search]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Applicants</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New applicant
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter("open")}
              className={
                "rounded-full border px-3 py-1 text-xs font-bold " +
                (statusFilter === "open"
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-surface text-fg-muted")
              }
            >
              New + Screening
            </button>
            {APPLICANT_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-bold " +
                  (statusFilter === s
                    ? "border-primary bg-primary text-primary-fg"
                    : "border-border bg-surface text-fg-muted")
                }
              >
                {s}
              </button>
            ))}
            <div className="ml-auto w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search applicants"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">App #</th>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Screening</th>
                <th>Checklist</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-fg-muted">
                    No applicants match.
                  </td>
                </tr>
              )}
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-border/40">
                  <td className="py-2">#{a.applicationNumber}</td>
                  <td>
                    <Link
                      href={`/properties/leasing/applicants/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.displayName}
                    </Link>
                    {a.promotedToTenantId && (
                      <Badge variant="outline" className="ml-2">
                        Promoted
                      </Badge>
                    )}
                  </td>
                  <td className="text-fg-muted">{a.email || "—"}</td>
                  <td>
                    <Badge variant={a.status === "Approved" ? "gain" : "muted"}>
                      {a.status}
                    </Badge>
                  </td>
                  <td className="text-fg-muted">{a.screeningStatus}</td>
                  <td className="text-fg-muted">
                    {a.checklistCheckedCount} / {a.checklistTotal} ({a.checklistOverallPct}%)
                  </td>
                  <td className="text-fg-muted">
                    {new Date(a.applicationReceivedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-fg-muted">
            Match count: {rows.length} loaded.
          </p>
        </CardContent>
      </Card>

      <ApplicantFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={async (id) => {
          await load();
          router.push(`/properties/leasing/applicants/${id}`);
        }}
      />
    </div>
  );
}
