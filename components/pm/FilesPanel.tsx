"use client";

// Polymorphic Files panel. Drops into the `Files` tab on every PM detail page,
// AND into the central /properties/files list in Phase 8 (no parent filter).
// Phase 0 keeps file storage virtual — the upload form records a metadata
// stub (`storageKey` is a UUID placeholder). Phase 8 will swap in real blob
// storage.
import * as React from "react";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import type { FileLocationType, FileSharing } from "@/types/pm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface FileRow {
  id: string;
  title: string;
  sharing: FileSharing;
  categoryId: string;
  locationType: FileLocationType;
  locationId: string | null;
  mimeType: string;
  originalFilename: string;
  fileSize: number;
  storageKey: string;
  uploadedAt: string;
  lastModifiedAt: string;
}

interface Category {
  id: string;
  name: string;
  systemSeeded: boolean;
}

interface Props {
  /** Pass `Account` for an org-wide upload (no parent). */
  locationType: FileLocationType;
  locationId: string | null;
}

export function FilesPanel({ locationType, locationId }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<FileRow[]>([]);
  const [cats, setCats] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ locationType });
    if (locationId) params.set("locationId", locationId);
    const [filesRes, catRes] = await Promise.all([
      fetch(`/api/pm/files?${params.toString()}`),
      fetch("/api/pm/file-categories"),
    ]);
    if (filesRes.ok) setRows((await filesRes.json()) as FileRow[]);
    if (catRes.ok) setCats((await catRes.json()) as Category[]);
    setLoading(false);
  }, [locationType, locationId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function upload(form: FormData) {
    const file = form.get("file") as File | null;
    const categoryId = String(form.get("categoryId") ?? "");
    const title = String(form.get("title") ?? "") || file?.name || "Untitled";
    if (!file || !categoryId) {
      toast({ title: "Pick a file + category", variant: "error" });
      return;
    }
    const payload = {
      title,
      sharing: "Internal",
      categoryId,
      locationType,
      locationId,
      mimeType: file.type || "application/octet-stream",
      originalFilename: file.name,
      fileSize: file.size,
      // Phase 0 placeholder: a UUID stand-in. Phase 8 swaps in S3/GCS key.
      storageKey: `phase0/${crypto.randomUUID()}`,
    };
    const res = await fetch("/api/pm/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Upload failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "File saved", variant: "success" });
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/pm/files/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Delete failed", variant: "error" });
      return;
    }
    toast({ title: "File deleted", variant: "success" });
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          action={upload}
          className="grid gap-3 rounded border border-border bg-surface p-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
        >
          <div className="space-y-1">
            <Label htmlFor="fp-title">Title</Label>
            <Input id="fp-title" name="title" placeholder="optional" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fp-cat">Category *</Label>
            <select
              id="fp-cat"
              name="categoryId"
              required
              className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
            >
              <option value="">Choose…</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 md:col-span-3">
            <Label htmlFor="fp-file">File</Label>
            <Input id="fp-file" name="file" type="file" required />
          </div>
          <div className="md:col-span-3">
            <Button type="submit">Upload</Button>
          </div>
        </form>

        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
            <tr>
              <th className="py-2">Title</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="py-4 text-fg-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-fg-muted">
                  No files yet.
                </td>
              </tr>
            )}
            {rows.map((f) => (
              <tr key={f.id} className="border-b border-border/40">
                <td className="py-2 text-fg">{f.title}</td>
                <td className="text-fg-muted">{Math.round(f.fileSize / 1024)} KB</td>
                <td className="text-fg-muted">
                  {format(new Date(f.uploadedAt), "yyyy-MM-dd")}
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error"
                    aria-label="Delete"
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

export default FilesPanel;
