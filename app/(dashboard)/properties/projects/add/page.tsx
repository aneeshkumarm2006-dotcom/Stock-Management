// /properties/projects/add — create form (PDR §3.15, Phase 5).
// BR-TP-8 — Property + ProjectType + ProjectLead are all required before the
// submit button enables. Tasks cannot be linked here; the detail page hosts
// the post-creation add flow.
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

interface PropertyRow {
  id: string;
  propertyName: string;
}
interface ProjectTypeRow {
  id: string;
  name: string;
}
interface UserRow {
  id: string;
  name?: string;
  email?: string;
}

export default function AddProjectPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [properties, setProperties] = React.useState<PropertyRow[]>([]);
  const [projectTypes, setProjectTypes] = React.useState<ProjectTypeRow[]>([]);
  const [users, setUsers] = React.useState<UserRow[]>([]);

  const [projectTypeId, setProjectTypeId] = React.useState("");
  const [propertyId, setPropertyId] = React.useState("");
  const [projectLeadUserId, setProjectLeadUserId] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [budget, setBudget] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) setProperties((await r.json()) as PropertyRow[]);
    });
    fetch("/api/pm/project-types").then(async (r) => {
      if (r.ok) setProjectTypes((await r.json()) as ProjectTypeRow[]);
    });
    fetch("/api/pm/org-members").then(async (r) => {
      if (r.ok) setUsers((await r.json()) as UserRow[]);
    });
  }, []);

  const canSubmit =
    projectTypeId &&
    propertyId &&
    projectLeadUserId &&
    !saving;

  async function save() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        projectTypeId,
        propertyId,
        projectLeadUserId,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
      };
      if (budget) payload.budget = Number(budget);
      if (dueDate) payload.dueDate = new Date(dueDate).toISOString();

      const res = await fetch("/api/pm/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ title: "Failed", description: err.error, variant: "error" });
        return;
      }
      const created = (await res.json()) as { id: string };
      toast({ title: "Project created", variant: "success" });
      router.push(`/properties/projects/${created.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/properties/projects")}
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Projects
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="proj-property">
                Property <span className="text-error">*</span>
              </Label>
              <select
                id="proj-property"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
              >
                <option value="">— Select —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.propertyName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-type">
                Project type <span className="text-error">*</span>
              </Label>
              <select
                id="proj-type"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={projectTypeId}
                onChange={(e) => setProjectTypeId(e.target.value)}
              >
                <option value="">— Select —</option>
                {projectTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-lead">
                Project lead <span className="text-error">*</span>
              </Label>
              <select
                id="proj-lead"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={projectLeadUserId}
                onChange={(e) => setProjectLeadUserId(e.target.value)}
              >
                <option value="">— Select —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email || u.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-name">Name</Label>
              <Input
                id="proj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                placeholder="e.g. 2026 exterior repaint"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-budget">Budget (USD)</Label>
              <Input
                id="proj-budget"
                type="number"
                min="0"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-due">Due date</Label>
              <Input
                id="proj-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label htmlFor="proj-desc">Description</Label>
              <textarea
                id="proj-desc"
                className="min-h-[100px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <p className="mt-4 text-xs text-fg-muted">
            BR-TP-8 — Tasks can be linked to this project after creation.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => router.push("/properties/projects")}
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={!canSubmit}>
          {saving ? "Creating…" : "Create project"}
        </Button>
      </div>
    </div>
  );
}
