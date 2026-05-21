// /settings/pm/file-categories — Manage Categories. BR-FI-6 enforced
// server-side: delete blocked when inUseCount > 0 or systemSeeded.
"use client";

import * as React from "react";
import { Trash2, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface Category {
  id: string;
  name: string;
  systemSeeded: boolean;
  inUseCount: number;
  active: boolean;
}

export default function FileCategoriesPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/file-categories");
    if (r.ok) setRows((await r.json()) as Category[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const res = await fetch("/api/pm/file-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    setName("");
    toast({ title: "Category added", variant: "success" });
    await load();
  }

  async function remove(c: Category) {
    if (c.systemSeeded) return;
    if (c.inUseCount > 0) {
      toast({
        title: "Cannot delete",
        description: `Reassign the ${c.inUseCount} file(s) using this category first.`,
        variant: "error",
      });
      return;
    }
    const res = await fetch(`/api/pm/file-categories/${c.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Delete failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Deleted", variant: "success" });
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>File categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="fc-name">Add category</Label>
            <Input
              id="fc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Inspections"
            />
          </div>
          <Button onClick={create}>Add</Button>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
            <tr>
              <th className="py-2">Name</th>
              <th>In use</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={3} className="py-4 text-fg-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((c) => (
                <tr key={c.id} className="border-b border-border/40">
                  <td className="py-2 text-fg">
                    <span className="flex items-center gap-2">
                      {c.name}
                      {c.systemSeeded && (
                        <Lock className="h-3 w-3 text-fg-muted" aria-label="System-seeded" />
                      )}
                    </span>
                  </td>
                  <td className="text-fg-muted">{c.inUseCount}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      disabled={c.systemSeeded || c.inUseCount > 0}
                      className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
                      aria-label="Delete category"
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
