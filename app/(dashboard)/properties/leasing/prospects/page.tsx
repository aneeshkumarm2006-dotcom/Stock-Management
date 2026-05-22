// /properties/leasing/prospects — CRM funnel inbox.
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ProspectFormModal } from "@/components/pm/ProspectFormModal";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/types/pm";

interface ProspectRow {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  status: ProspectStatus;
  movingDate: string | null;
  beds: number | null;
  convertedToApplicantId: string | null;
  updatedAt: string;
}

export default function ProspectsPage() {
  const [rows, setRows] = React.useState<ProspectRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] =
    React.useState<ProspectStatus | "all">("all");
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (search.trim()) params.set("q", search.trim());
    const r = await fetch(`/api/pm/prospects?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as ProspectRow[]);
    setLoading(false);
  }, [statusFilter, search]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Prospects</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add prospect
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter("all")}
              className={
                "rounded-full border px-3 py-1 text-xs font-bold " +
                (statusFilter === "all"
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-surface text-fg-muted")
              }
            >
              All
              <Badge variant="muted" className="ml-1.5">
                {rows.length}
              </Badge>
            </button>
            {PROSPECT_STATUSES.map((s) => {
              const count = rows.filter((r) => r.status === s).length;
              return (
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
                  <Badge variant="muted" className="ml-1.5">
                    {count}
                  </Badge>
                </button>
              );
            })}
            <div className="ml-auto w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prospects"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Name</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Moving date</th>
                <th>Beds</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    No prospects match.
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border/40">
                  <td className="py-2">
                    <Link
                      href={`/properties/leasing/prospects/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.displayName}
                    </Link>
                    {p.convertedToApplicantId && (
                      <Badge variant="outline" className="ml-2">
                        Converted
                      </Badge>
                    )}
                  </td>
                  <td className="text-fg-muted">
                    {p.email || p.phone || "—"}
                  </td>
                  <td>
                    <Badge variant={p.status === "Converted" ? "gain" : "muted"}>
                      {p.status}
                    </Badge>
                  </td>
                  <td className="text-fg-muted">
                    {p.movingDate
                      ? new Date(p.movingDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="text-fg-muted">{p.beds ?? "—"}</td>
                  <td className="text-fg-muted">
                    {new Date(p.updatedAt).toLocaleDateString()}
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

      <ProspectFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
