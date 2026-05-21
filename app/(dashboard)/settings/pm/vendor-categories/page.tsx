// /settings/pm/vendor-categories — class × subCategory taxonomy (BR-MV-1).
"use client";

import * as React from "react";
import { Trash2, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface VendorCategory {
  id: string;
  class: string;
  subCategory: string;
  displayName: string;
  systemSeeded: boolean;
  active: boolean;
}

export default function VendorCategoriesPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<VendorCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [cls, setCls] = React.useState("");
  const [sub, setSub] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/vendor-categories");
    if (r.ok) setRows((await r.json()) as VendorCategory[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!cls.trim()) return;
    const res = await fetch("/api/pm/vendor-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class: cls.trim(), subCategory: sub.trim() }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    setCls("");
    setSub("");
    toast({ title: "Category added", variant: "success" });
    await load();
  }

  async function archive(c: VendorCategory) {
    if (c.systemSeeded) return;
    const res = await fetch(`/api/pm/vendor-categories/${c.id}`, {
      method: "DELETE",
    });
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
        <CardTitle>Vendor categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1">
            <Label htmlFor="vc-class">Class</Label>
            <Input
              id="vc-class"
              value={cls}
              onChange={(e) => setCls(e.target.value)}
              placeholder="Plumbing"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vc-sub">Sub-category (optional)</Label>
            <Input
              id="vc-sub"
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              placeholder="Drain cleaning"
            />
          </div>
          <Button onClick={create}>Add</Button>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
            <tr>
              <th className="py-2">Display name</th>
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
              rows.map((c) => (
                <tr key={c.id} className="border-b border-border/40">
                  <td className="py-2 text-fg">
                    <span className="flex items-center gap-2">
                      {c.displayName}
                      {c.systemSeeded && (
                        <Lock className="h-3 w-3 text-fg-muted" />
                      )}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => archive(c)}
                      disabled={c.systemSeeded}
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
