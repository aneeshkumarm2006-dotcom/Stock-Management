// Generic flat-name taxonomy CRUD (TaskCategory, ProjectType). Both endpoints
// share the same shape — { id, name, color?, systemSeeded, active }.
"use client";

import * as React from "react";
import { Trash2, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface NamedRow {
  id: string;
  name: string;
  color: string | null;
  systemSeeded: boolean;
  active: boolean;
}

interface Props {
  title: string;
  endpoint: string;
  placeholder: string;
}

export function NameCategoryList({ title, endpoint, placeholder }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<NamedRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(endpoint);
    if (r.ok) setRows((await r.json()) as NamedRow[]);
    setLoading(false);
  }, [endpoint]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    setName("");
    toast({ title: "Added", variant: "success" });
    await load();
  }

  async function archive(row: NamedRow) {
    if (row.systemSeeded) return;
    const res = await fetch(`${endpoint}/${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Delete failed", variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor={`${endpoint}-name`}>Add</Label>
            <Input
              id={`${endpoint}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
            />
          </div>
          <Button onClick={create}>Add</Button>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
            <tr>
              <th className="py-2">Name</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={2} className="py-4 text-fg-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="py-2 text-fg">
                    <span className="flex items-center gap-2">
                      {r.name}
                      {r.systemSeeded && (
                        <Lock className="h-3 w-3 text-fg-muted" />
                      )}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => archive(r)}
                      disabled={r.systemSeeded}
                      className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Archive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default NameCategoryList;
