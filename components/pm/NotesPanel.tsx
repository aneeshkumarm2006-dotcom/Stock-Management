"use client";

// Polymorphic Notes panel — drops into the `Notes` tab on every PM detail
// page (Property, Lease, Vendor, …). Hits /api/pm/notes.
import * as React from "react";
import { format } from "date-fns";
import type { ParentType, NoteType } from "@/types/pm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

interface Note {
  id: string;
  parentType: ParentType;
  parentId: string;
  body: string;
  noteType: NoteType;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  parentType: ParentType;
  parentId: string;
  defaultNoteType?: NoteType;
}

export function NotesPanel({
  parentType,
  parentId,
  defaultNoteType = "RENTAL",
}: Props) {
  const { toast } = useToast();
  const [items, setItems] = React.useState<Note[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [noteType, setNoteType] = React.useState<NoteType>(defaultNoteType);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(
      `/api/pm/notes?parentType=${parentType}&parentId=${parentId}`,
    );
    if (r.ok) setItems((await r.json()) as Note[]);
    setLoading(false);
  }, [parentType, parentId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!body.trim()) return;
    const res = await fetch("/api/pm/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentType,
        parentId,
        body: body.trim(),
        noteType,
      }),
    });
    if (!res.ok) {
      toast({ title: "Failed", variant: "error" });
      return;
    }
    setBody("");
    toast({ title: "Note saved", variant: "success" });
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="note-body">Add a note</Label>
          <textarea
            id="note-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full rounded border border-border bg-surface-highest p-2 text-sm text-fg"
          />
          <div className="flex items-center justify-between">
            <select
              value={noteType}
              onChange={(e) => setNoteType(e.target.value as NoteType)}
              className="h-9 rounded border border-border bg-surface-highest px-2 text-xs text-fg"
            >
              <option value="RENTAL">Rental</option>
              <option value="LEASING">Leasing</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="ACCOUNTING">Accounting</option>
              <option value="GENERAL">General</option>
            </select>
            <Button onClick={submit} size="sm" disabled={!body.trim()}>
              Save note
            </Button>
          </div>
        </div>

        <ul className="space-y-2">
          {loading && <li className="text-sm text-fg-muted">Loading…</li>}
          {!loading && items.length === 0 && (
            <li className="text-sm text-fg-muted">No notes yet.</li>
          )}
          {items.map((n) => (
            <li
              key={n.id}
              className="rounded border border-border bg-surface p-3 text-sm"
            >
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-fg-muted">
                <span>{n.noteType}</span>
                <span>{format(new Date(n.createdAt), "yyyy-MM-dd HH:mm")}</span>
              </div>
              <p className="whitespace-pre-wrap text-fg">{n.body}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default NotesPanel;
