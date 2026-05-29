// Generic flat-name taxonomy CRUD (TaskCategory, ProjectType). Both endpoints
// share the same shape — { id, name, color?, systemSeeded, active }.
"use client";

import * as React from "react";
import { Trash2, Lock, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { EditEntityButton } from "@/components/pm/EditEntityButton";

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
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);

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

  function startEdit(row: NamedRow) {
    setEditingId(row.id);
    setEditingName(row.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }

  async function saveEdit(row: NamedRow) {
    const trimmed = editingName.trim();
    if (!trimmed) {
      toast({ title: "Name is required", variant: "error" });
      return;
    }
    if (trimmed === row.name) {
      cancelEdit();
      return;
    }
    setSavingEdit(true);
    const res = await fetch(`${endpoint}/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    setSavingEdit(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Rename failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Renamed", variant: "success" });
    cancelEdit();
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
              rows.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-2 text-fg">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(r);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          disabled={savingEdit}
                          className="h-7"
                        />
                      ) : (
                        <span className="flex items-center gap-2">
                          {r.name}
                          {r.systemSeeded && (
                            <Lock className="h-3 w-3 text-fg-muted" />
                          )}
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {isEditing ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => saveEdit(r)}
                            disabled={savingEdit}
                            aria-label="Save"
                            className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-success disabled:opacity-30"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={savingEdit}
                            aria-label="Cancel"
                            className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-fg disabled:opacity-30"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <EditEntityButton
                            onClick={() => startEdit(r)}
                            disabled={r.systemSeeded}
                            label={r.systemSeeded ? "System-seeded" : "Rename"}
                          />
                          <button
                            type="button"
                            onClick={() => archive(r)}
                            disabled={r.systemSeeded}
                            className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Archive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default NameCategoryList;
