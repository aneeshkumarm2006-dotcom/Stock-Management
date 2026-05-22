// /properties/projects — Project list (PDR §3.15, Phase 5).
// Two tabs: In progress (default) / Closed. The Add project button routes
// to /properties/projects/add — a real page, not a modal, because BR-TP-8
// requires the post-creation step to add Tasks.
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";

interface Row {
  id: string;
  projectTypeId: string;
  propertyId: string;
  projectLeadUserId: string;
  name: string;
  budget: number;
  dueDate: string | null;
  taskCount: number;
  status: string;
  createdAt: string;
}

interface ProjectTypeRow {
  id: string;
  name: string;
}
interface PropertyRow {
  id: string;
  propertyName: string;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [tab, setTab] = React.useState<"in-progress" | "closed">(
    "in-progress",
  );
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [projectTypes, setProjectTypes] = React.useState<ProjectTypeRow[]>([]);
  const [properties, setProperties] = React.useState<PropertyRow[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/projects?status=${tab}`);
    if (r.ok) setRows((await r.json()) as Row[]);
    setLoading(false);
  }, [tab]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    fetch("/api/pm/project-types").then(async (r) => {
      if (r.ok) setProjectTypes((await r.json()) as ProjectTypeRow[]);
    });
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) setProperties((await r.json()) as PropertyRow[]);
    });
  }, []);

  const typeName = (id: string) =>
    projectTypes.find((p) => p.id === id)?.name ?? "—";
  const propertyName = (id: string) =>
    properties.find((p) => p.id === id)?.propertyName ?? "—";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <Button
            size="sm"
            onClick={() => router.push("/properties/projects/add")}
          >
            <Plus className="h-3.5 w-3.5" /> Add project
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-1 border-b border-border text-sm">
            <TabButton
              label={`In progress (${tab === "in-progress" ? rows.length : "…"})`}
              selected={tab === "in-progress"}
              onClick={() => setTab("in-progress")}
            />
            <TabButton
              label={`Closed (${tab === "closed" ? rows.length : "…"})`}
              selected={tab === "closed"}
              onClick={() => setTab("closed")}
            />
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Name</th>
                <th>Type</th>
                <th>Property</th>
                <th>Tasks</th>
                <th>Budget</th>
                <th>Due</th>
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
                    No projects in this tab.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="py-2">
                    <Link
                      href={`/properties/projects/${r.id}`}
                      className="font-medium text-fg hover:underline"
                    >
                      {r.name || "Untitled"}
                    </Link>
                  </td>
                  <td className="text-fg-muted">{typeName(r.projectTypeId)}</td>
                  <td className="text-fg-muted">
                    {propertyName(r.propertyId)}
                  </td>
                  <td className="tabular-nums text-fg-muted">{r.taskCount}</td>
                  <td className="tabular-nums text-fg">
                    <CurrencyAmount cents={r.budget} />
                  </td>
                  <td className="text-fg-muted">
                    {r.dueDate
                      ? new Date(r.dueDate).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
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
