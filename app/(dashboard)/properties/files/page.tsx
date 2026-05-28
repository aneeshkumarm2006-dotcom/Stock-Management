// /properties/files — central, polymorphic Files list (PDR §3.29, §6.7, §4.7;
// PROPERTY_TODO Phase 8).
//
// Aggregates every PmFile across all locationTypes shipped in Phases 1–7 plus
// account-level uploads. Filters (locationType, categoryId, sharing,
// uploadedAt range, modifiedAt range), free-text search, server-side match
// counter (BR-CX-2), and bulk actions live on this page. Per-row metadata
// edits + delete bubble up to `/api/pm/files/[id]`; bulk actions go to
// `/api/pm/files/bulk`.
//
// Storage note: Phase 0 keeps blob storage virtual — `storageKey` is a
// UUID placeholder, no real upload happens client-side. The list surface,
// upload modal, and category manager are all wired against the metadata
// catalog so swapping in S3/GCS later is a server-side change.
"use client";

import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Plus,
  Tags,
  Trash2,
  FolderInput,
  Share2,
  MoreHorizontal,
  Download,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import type { FileLocationType, FileSharing } from "@/types/pm";
import { FILE_LOCATION_TYPES } from "@/lib/pm/parentTypes";
import { computeWarnings } from "@/lib/pm/warnings";
import { WarningInline } from "@/components/pm/WarningBadge";

interface LocationDisplay {
  label: string;
  subLabel: string;
  href: string | null;
}

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
  storageUrl: string;
  resourceType: "image" | "video" | "raw";
  uploadedAt: string;
  lastModifiedAt: string;
  uploadedByUserId: string;
  lastModifiedByUserId: string;
  uploadedByName: string;
  lastModifiedByName: string;
  locationDisplay: LocationDisplay | null;
}

interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

// Build a Cloudinary URL that forces the browser to download (Content-Disposition:
// attachment) instead of rendering inline. Works for image/video/raw. We inject
// `fl_attachment:<filename>` after `/upload/` so the saved filename matches the
// user-facing original filename.
function buildDownloadUrl(storageUrl: string, originalFilename: string): string {
  if (!storageUrl) return "";
  // Strip the extension — Cloudinary appends it back from the public_id.
  const base = originalFilename.replace(/\.[^./\\]+$/, "");
  const safe = encodeURIComponent(base).replace(/%20/g, "_");
  return storageUrl.replace("/upload/", `/upload/fl_attachment:${safe}/`);
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

interface CategoryRow {
  id: string;
  name: string;
  systemSeeded: boolean;
  inUseCount: number;
  active: boolean;
}

type SortField = "lastModifiedAt" | "uploadedAt" | "title";
type SortDir = "asc" | "desc";

interface Filters {
  q: string;
  locationType: "" | FileLocationType;
  categoryId: string;
  sharing: "" | FileSharing;
  uploadedFrom: string;
  uploadedTo: string;
  modifiedFrom: string;
  modifiedTo: string;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  locationType: "",
  categoryId: "",
  sharing: "",
  uploadedFrom: "",
  uploadedTo: "",
  modifiedFrom: "",
  modifiedTo: "",
};

const SHARING_LABEL: Record<FileSharing, string> = {
  Internal: "Internal",
  Resident: "Resident",
  Owner: "Owner",
  PublicLink: "Public link",
};

const SHARING_VALUES: FileSharing[] = [
  "Internal",
  "Resident",
  "Owner",
  "PublicLink",
];

export default function FilesPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<FileRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [cats, setCats] = React.useState<CategoryRow[]>([]);
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [sortField, setSortField] = React.useState<SortField>("lastModifiedAt");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [categoriesOpen, setCategoriesOpen] = React.useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = React.useState(false);
  const [bulkShareOpen, setBulkShareOpen] = React.useState(false);

  const loadCategories = React.useCallback(async () => {
    const r = await fetch("/api/pm/file-categories");
    if (r.ok) setCats((await r.json()) as CategoryRow[]);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    qs.set("expand", "display");
    qs.set("sort", sortField);
    qs.set("dir", sortDir);
    if (filters.q.trim()) qs.set("q", filters.q.trim());
    if (filters.locationType) qs.set("locationType", filters.locationType);
    if (filters.categoryId) qs.set("categoryId", filters.categoryId);
    if (filters.sharing) qs.set("sharing", filters.sharing);
    if (filters.uploadedFrom) qs.set("uploadedFrom", `${filters.uploadedFrom}T00:00:00.000Z`);
    if (filters.uploadedTo) qs.set("uploadedTo", `${filters.uploadedTo}T23:59:59.999Z`);
    if (filters.modifiedFrom) qs.set("modifiedFrom", `${filters.modifiedFrom}T00:00:00.000Z`);
    if (filters.modifiedTo) qs.set("modifiedTo", `${filters.modifiedTo}T23:59:59.999Z`);
    const r = await fetch(`/api/pm/files?${qs.toString()}`);
    if (r.ok) {
      const data = (await r.json()) as { rows: FileRow[]; total: number };
      setRows(data.rows);
      setTotal(data.total);
      // Drop any selection rows no longer in view.
      setSelected((prev) => {
        const next = new Set<string>();
        const ids = new Set(data.rows.map((d) => d.id));
        Array.from(prev).forEach((id) => {
          if (ids.has(id)) next.add(id);
        });
        return next;
      });
    }
    setLoading(false);
  }, [filters, sortField, sortDir]);

  React.useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // Debounce the search input; everything else fires immediately.
  React.useEffect(() => {
    const handle = setTimeout(() => {
      load();
    }, 150);
    return () => clearTimeout(handle);
  }, [load]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "title" ? "asc" : "desc");
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  const catById = React.useMemo(
    () => Object.fromEntries(cats.map((c) => [c.id, c])),
    [cats],
  );

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Delete ${selected.size} file(s)? Files attached to active leases or work orders may be referenced in their audit trail.`,
      )
    ) {
      return;
    }
    const res = await fetch("/api/pm/files/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids: Array.from(selected) }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Delete failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: `Deleted ${selected.size} file(s)`, variant: "success" });
    setSelected(new Set());
    await load();
    await loadCategories();
  }

  async function bulkDownload() {
    if (selected.size === 0) return;
    const targets = rows.filter((r) => selected.has(r.id) && r.storageUrl);
    const skipped = selected.size - targets.length;
    if (targets.length === 0) {
      toast({
        title: "No downloadable files",
        description:
          "Selected files have no storage URL (legacy placeholder uploads). Re-upload to enable downloads.",
        variant: "error",
      });
      return;
    }
    // Browsers throttle simultaneous downloads — stagger by 250ms so each file
    // gets its own user-initiated tick.
    targets.forEach((row, i) => {
      setTimeout(() => {
        triggerDownload(
          buildDownloadUrl(row.storageUrl, row.originalFilename),
          row.originalFilename,
        );
      }, i * 250);
    });
    toast({
      title: `Downloading ${targets.length} file(s)`,
      description: skipped > 0 ? `${skipped} skipped (no storage URL).` : undefined,
      variant: "success",
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCategoriesOpen(true)}
            >
              <Tags className="h-3.5 w-3.5" /> Manage categories
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Upload account file
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            cats={cats}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-muted">
            <span aria-live="polite">
              {loading ? "Loading…" : `${total} match${total === 1 ? "" : "es"}`}
              {selected.size > 0 && (
                <span className="ml-2 text-fg">
                  • {selected.size} selected
                </span>
              )}
            </span>
            <span className="text-fg-muted/60">
              Sharing controls portal visibility only — every PM in this org
              can see every file (BR-FI-7).
            </span>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
              <Button size="sm" variant="outline" onClick={bulkDownload}>
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBulkMoveOpen(true)}
              >
                <FolderInput className="h-3.5 w-3.5" /> Move to category…
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBulkShareOpen(true)}
              >
                <Share2 className="h-3.5 w-3.5" /> Change sharing…
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={bulkDelete}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          )}

          <FilesTable
            rows={rows}
            loading={loading}
            selected={selected}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            catById={catById}
            sortField={sortField}
            sortDir={sortDir}
            onSort={toggleSort}
            onRowChanged={async () => {
              await load();
              await loadCategories();
            }}
            categories={cats}
          />
        </CardContent>
      </Card>

      <UploadAccountFileModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        categories={cats}
        onSaved={async () => {
          await load();
          await loadCategories();
        }}
      />

      <ManageCategoriesModal
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        categories={cats}
        onChanged={async () => {
          await loadCategories();
          await load();
        }}
      />

      <BulkMoveModal
        open={bulkMoveOpen}
        onClose={() => setBulkMoveOpen(false)}
        categories={cats}
        selectedIds={Array.from(selected)}
        onSaved={async () => {
          setSelected(new Set());
          await load();
          await loadCategories();
        }}
      />

      <BulkShareModal
        open={bulkShareOpen}
        onClose={() => setBulkShareOpen(false)}
        selectedIds={Array.from(selected)}
        onSaved={async () => {
          setSelected(new Set());
          await load();
        }}
      />
    </div>
  );
}

function FilterBar({
  filters,
  setFilters,
  cats,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  cats: CategoryRow[];
}) {
  function reset() {
    setFilters(EMPTY_FILTERS);
  }
  const anyActive =
    filters.q ||
    filters.locationType ||
    filters.categoryId ||
    filters.sharing ||
    filters.uploadedFrom ||
    filters.uploadedTo ||
    filters.modifiedFrom ||
    filters.modifiedTo;

  return (
    <div className="space-y-3 rounded border border-border bg-surface p-3">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="f-search" className="text-xs">
            Search
          </Label>
          <Input
            id="f-search"
            value={filters.q}
            onChange={(e) =>
              setFilters((f) => ({ ...f, q: e.target.value }))
            }
            placeholder="Title or filename"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-location" className="text-xs">
            Location type
          </Label>
          <select
            id="f-location"
            value={filters.locationType}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                locationType: e.target.value as Filters["locationType"],
              }))
            }
            className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
          >
            <option value="">All locations</option>
            {FILE_LOCATION_TYPES.map((lt) => (
              <option key={lt} value={lt}>
                {lt}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-cat" className="text-xs">
            Category
          </Label>
          <select
            id="f-cat"
            value={filters.categoryId}
            onChange={(e) =>
              setFilters((f) => ({ ...f, categoryId: e.target.value }))
            }
            className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
          >
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.inUseCount})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-sharing" className="text-xs">
            Sharing
          </Label>
          <select
            id="f-sharing"
            value={filters.sharing}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                sharing: e.target.value as Filters["sharing"],
              }))
            }
            className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
          >
            <option value="">All</option>
            {SHARING_VALUES.map((s) => (
              <option key={s} value={s}>
                {SHARING_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="f-up-from" className="text-xs">
            Uploaded from
          </Label>
          <Input
            id="f-up-from"
            type="date"
            value={filters.uploadedFrom}
            onChange={(e) =>
              setFilters((f) => ({ ...f, uploadedFrom: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-up-to" className="text-xs">
            Uploaded to
          </Label>
          <Input
            id="f-up-to"
            type="date"
            value={filters.uploadedTo}
            onChange={(e) =>
              setFilters((f) => ({ ...f, uploadedTo: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-mod-from" className="text-xs">
            Modified from
          </Label>
          <Input
            id="f-mod-from"
            type="date"
            value={filters.modifiedFrom}
            onChange={(e) =>
              setFilters((f) => ({ ...f, modifiedFrom: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-mod-to" className="text-xs">
            Modified to
          </Label>
          <Input
            id="f-mod-to"
            type="date"
            value={filters.modifiedTo}
            onChange={(e) =>
              setFilters((f) => ({ ...f, modifiedTo: e.target.value }))
            }
          />
        </div>
      </div>
      {anyActive && (
        <button
          type="button"
          onClick={reset}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function FilesTable({
  rows,
  loading,
  selected,
  onToggleRow,
  onToggleAll,
  catById,
  sortField,
  sortDir,
  onSort,
  onRowChanged,
  categories,
}: {
  rows: FileRow[];
  loading: boolean;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  catById: Record<string, CategoryRow>;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  onRowChanged: () => Promise<void>;
  categories: CategoryRow[];
}) {
  const allChecked = rows.length > 0 && selected.size === rows.length;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
        <tr>
          <th className="py-2 pr-2">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={allChecked}
              onChange={onToggleAll}
            />
          </th>
          <th>
            <SortableHeader
              field="title"
              label="Title"
              sortField={sortField}
              sortDir={sortDir}
              onSort={onSort}
            />
          </th>
          <th>Sharing</th>
          <th>Category</th>
          <th>Location</th>
          <th>
            <SortableHeader
              field="lastModifiedAt"
              label="Last modified by"
              sortField={sortField}
              sortDir={sortDir}
              onSort={onSort}
            />
          </th>
          <th>
            <SortableHeader
              field="uploadedAt"
              label="Uploaded"
              sortField={sortField}
              sortDir={sortDir}
              onSort={onSort}
            />
          </th>
          <th />
        </tr>
      </thead>
      <tbody>
        {loading && (
          <tr>
            <td colSpan={8} className="py-6 text-fg-muted">
              Loading…
            </td>
          </tr>
        )}
        {!loading && rows.length === 0 && (
          <tr>
            <td colSpan={8} className="py-6 text-fg-muted">
              No files match. Upload an account file or attach one from any
              property/lease/vendor detail page to populate this list.
            </td>
          </tr>
        )}
        {rows.map((r) => (
          <FileRowView
            key={r.id}
            row={r}
            checked={selected.has(r.id)}
            onCheck={() => onToggleRow(r.id)}
            catName={catById[r.categoryId]?.name ?? "—"}
            categories={categories}
            onChanged={onRowChanged}
          />
        ))}
      </tbody>
    </table>
  );
}

function SortableHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-fg-muted hover:text-fg"
    >
      {label}
      {active && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

function FileRowView({
  row,
  checked,
  onCheck,
  catName,
  categories,
  onChanged,
}: {
  row: FileRow;
  checked: boolean;
  onCheck: () => void;
  catName: string;
  categories: CategoryRow[];
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = React.useState(false);

  async function remove() {
    if (
      !confirm(
        `Delete "${row.title}"? This file is attached to ${
          row.locationType === "Account"
            ? "the account"
            : row.locationDisplay?.label ?? row.locationType
        } — deleting may break its audit trail if the parent entity is still active.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/pm/files/${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Delete failed",
        description: err.error,
        variant: "error",
      });
      return;
    }
    toast({ title: "File deleted", variant: "success" });
    await onChanged();
  }

  return (
    <tr className="border-b border-border/40">
      <td className="py-2 pr-2 align-top">
        <input
          type="checkbox"
          aria-label={`Select ${row.title}`}
          checked={checked}
          onChange={onCheck}
        />
      </td>
      <td className="align-top text-fg">
        {row.storageUrl ? (
          <a
            href={row.storageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-fg hover:underline"
          >
            {row.title}
          </a>
        ) : (
          <span
            className="font-medium text-fg-muted"
            title="No storage URL — legacy placeholder upload"
          >
            {row.title}
          </span>
        )}
        <div className="text-[11px] text-fg-muted">
          {row.originalFilename} • {formatBytes(row.fileSize)}
        </div>
      </td>
      <td className="align-top">
        <SharingBadge sharing={row.sharing} />
      </td>
      <td className="align-top text-fg-muted">{catName}</td>
      <td className="align-top text-fg-muted">
        {row.locationDisplay ? (
          <>
            {row.locationDisplay.href ? (
              <Link
                href={row.locationDisplay.href}
                className="text-fg hover:underline"
              >
                {row.locationDisplay.label}
              </Link>
            ) : (
              <span className="text-fg">{row.locationDisplay.label}</span>
            )}
            <div className="text-[11px] italic text-fg-muted/70">
              {row.locationDisplay.subLabel}
            </div>
          </>
        ) : (
          <span className="text-fg-muted/70 italic">Account file</span>
        )}
      </td>
      <td className="align-top text-fg-muted">
        {format(new Date(row.lastModifiedAt), "M/d/yyyy h:mm a")}
        <div className="text-[11px]">by {row.lastModifiedByName}</div>
      </td>
      <td className="align-top text-fg-muted">
        {format(new Date(row.uploadedAt), "M/d/yyyy")}
        <div className="text-[11px]">by {row.uploadedByName}</div>
      </td>
      <td className="align-top text-right">
        <Dropdown
          trigger={
            <span
              role="button"
              aria-label="Row actions"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-surface-high hover:text-fg"
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          }
        >
          <DropdownItem onClick={() => setEditOpen(true)}>
            Edit details
          </DropdownItem>
          {row.storageUrl ? (
            <>
              <DropdownItem
                onClick={() => window.open(row.storageUrl, "_blank", "noopener")}
              >
                <Eye className="h-3.5 w-3.5" /> View
              </DropdownItem>
              <DropdownItem
                onClick={() =>
                  triggerDownload(
                    buildDownloadUrl(row.storageUrl, row.originalFilename),
                    row.originalFilename,
                  )
                }
              >
                <Download className="h-3.5 w-3.5" /> Download
              </DropdownItem>
            </>
          ) : (
            <DropdownItem
              onClick={() =>
                toast({
                  title: "No file content",
                  description:
                    "This row was created before storage was wired. Delete and re-upload to enable view/download.",
                  variant: "error",
                })
              }
            >
              View / Download unavailable
            </DropdownItem>
          )}
          <DropdownItem
            className="text-error hover:bg-error/10 hover:text-error"
            onClick={remove}
          >
            Delete
          </DropdownItem>
        </Dropdown>
      </td>
      <EditFileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        row={row}
        categories={categories}
        onSaved={onChanged}
      />
    </tr>
  );
}

function SharingBadge({ sharing }: { sharing: FileSharing }) {
  if (sharing === "Internal") {
    return (
      <span className="rounded bg-surface-high px-1.5 py-0.5 text-[10px] font-bold uppercase text-fg-muted">
        Internal
      </span>
    );
  }
  const cls: Record<Exclude<FileSharing, "Internal">, string> = {
    Resident: "bg-info/10 text-info",
    Owner: "bg-primary/10 text-primary",
    PublicLink: "bg-warning/10 text-warning",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls[sharing]}`}
    >
      {SHARING_LABEL[sharing]}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Upload account file modal
// ---------------------------------------------------------------------------

function UploadAccountFileModal({
  open,
  onClose,
  categories,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  categories: CategoryRow[];
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [files, setFiles] = React.useState<File[]>([]);
  const [categoryId, setCategoryId] = React.useState("");
  const [sharing, setSharing] = React.useState<FileSharing>("Internal");
  const [locationType, setLocationType] = React.useState<
    "" | FileLocationType
  >("");
  const [locationId, setLocationId] = React.useState("");
  const [titleOverride, setTitleOverride] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  function reset() {
    setFiles([]);
    setCategoryId("");
    setSharing("Internal");
    setLocationType("");
    setLocationId("");
    setTitleOverride("");
    setDragOver(false);
  }

  React.useEffect(() => {
    if (!open) reset();
  }, [open]);

  function addFiles(fl: FileList | null) {
    if (!fl) return;
    const next = Array.from(fl);
    setFiles((prev) => [...prev, ...next]);
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    // Category and locationId presence checks moved to non-blocking warnings.
    // Zero-file upload stays a hard requirement — it's a true no-op, not a
    // data-quality issue.
    if (files.length === 0) {
      toast({ title: "Pick at least one file", variant: "error" });
      return;
    }
    setSaving(true);

    // One signature per upload session — Cloudinary timestamps are valid for
    // ~1 hour so a single signed payload covers every file we send below.
    const signRes = await fetch("/api/pm/files/sign", { method: "POST" });
    if (!signRes.ok) {
      const err = (await signRes.json().catch(() => ({}))) as { error?: string };
      setSaving(false);
      toast({
        title: "Storage not ready",
        description: err.error ?? "Could not get upload signature.",
        variant: "error",
      });
      return;
    }
    const sig = (await signRes.json()) as SignedUpload;

    let okCount = 0;
    const failed: string[] = [];
    for (const f of files) {
      // 1. POST the binary directly to Cloudinary.
      const cloudForm = new FormData();
      cloudForm.append("file", f);
      cloudForm.append("api_key", sig.apiKey);
      cloudForm.append("timestamp", String(sig.timestamp));
      cloudForm.append("signature", sig.signature);
      cloudForm.append("folder", sig.folder);
      const cloudRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`,
        { method: "POST", body: cloudForm },
      );
      if (!cloudRes.ok) {
        const err = (await cloudRes.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        failed.push(`${f.name}: ${err.error?.message ?? "cloud upload failed"}`);
        continue;
      }
      const cloud = (await cloudRes.json()) as {
        public_id: string;
        secure_url: string;
        bytes: number;
        resource_type: "image" | "video" | "raw";
      };

      // 2. Record metadata in our DB.
      const payload = {
        title: titleOverride.trim() || f.name,
        sharing,
        categoryId,
        locationType: locationType || "Account",
        locationId:
          !locationType || locationType === "Account"
            ? null
            : locationId.trim(),
        mimeType: f.type || "application/octet-stream",
        originalFilename: f.name,
        fileSize: cloud.bytes || f.size,
        storageKey: cloud.public_id,
        storageUrl: cloud.secure_url,
        resourceType: cloud.resource_type,
      };
      const res = await fetch("/api/pm/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        okCount += 1;
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        failed.push(`${f.name}: ${err.error ?? "save failed"}`);
      }
    }
    setSaving(false);
    if (okCount > 0) {
      toast({
        title: `Uploaded ${okCount} file(s)`,
        description: failed.length
          ? `${failed.length} failed`
          : undefined,
        variant: failed.length ? "default" : "success",
      });
    }
    if (failed.length > 0) {
      toast({
        title: "Some uploads failed",
        description: failed.join("\n"),
        variant: "error",
      });
    }
    if (okCount > 0) {
      reset();
      onClose();
      await onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title="Upload account file"
          description="Files uploaded here have no parent location by default — pick one below if you want to attach to a specific property, vendor, etc. Category is required (BR-FI-2)."
          onClose={onClose}
        />
        <div className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            className={
              "rounded border border-dashed p-4 text-center text-sm transition-colors " +
              (dragOver
                ? "border-primary bg-primary/5"
                : "border-border bg-surface")
            }
          >
            <p className="text-fg-muted">
              Drag files here or
              <label className="ml-1 cursor-pointer text-primary underline">
                pick files
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>
            </p>
          </div>
          {files.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-auto rounded border border-border bg-surface p-2 text-xs">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">
                    {f.name}{" "}
                    <span className="text-fg-muted">
                      ({formatBytes(f.size)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="ml-2 rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error"
                    aria-label={`Remove ${f.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="u-cat">Category *</Label>
              <select
                id="u-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="">Pick one…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="u-share">Sharing</Label>
              <select
                id="u-share"
                value={sharing}
                onChange={(e) => setSharing(e.target.value as FileSharing)}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                {SHARING_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {SHARING_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="u-loctype">Location type</Label>
              <select
                id="u-loctype"
                value={locationType}
                onChange={(e) => {
                  const v = e.target.value as Filters["locationType"];
                  setLocationType(v);
                  if (!v || v === "Account") setLocationId("");
                }}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="">Account (no parent)</option>
                {FILE_LOCATION_TYPES.filter((lt) => lt !== "Account").map(
                  (lt) => (
                    <option key={lt} value={lt}>
                      {lt}
                    </option>
                  ),
                )}
              </select>
            </div>
            {locationType && locationType !== "Account" && (
              <div className="space-y-1">
                <Label htmlFor="u-locid">Location ID *</Label>
                <Input
                  id="u-locid"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  placeholder="24-char ObjectId of the parent entity"
                />
              </div>
            )}
          </div>
          {files.length > 1 && (
            <div className="space-y-1">
              <Label htmlFor="u-title">Title override (optional)</Label>
              <Input
                id="u-title"
                value={titleOverride}
                onChange={(e) => setTitleOverride(e.target.value)}
                placeholder="Defaults to each file's name"
              />
              <p className="text-xs text-fg-muted/70">
                Leave blank to use each file&apos;s original name as its title.
              </p>
            </div>
          )}

          <WarningInline
            warnings={computeWarnings(
              { categoryId, locationType, locationId },
              "PmFile",
            )}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || files.length === 0}>
            {saving ? "Uploading…" : `Upload ${files.length || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Manage Categories modal
// ---------------------------------------------------------------------------

function ManageCategoriesModal({
  open,
  onClose,
  categories,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  categories: CategoryRow[];
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [newName, setNewName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [renaming, setRenaming] = React.useState<{
    id: string;
    name: string;
  } | null>(null);

  async function add() {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    const res = await fetch("/api/pm/file-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    setNewName("");
    await onChanged();
    toast({ title: "Category added", variant: "success" });
  }

  async function rename(id: string, name: string) {
    const res = await fetch(`/api/pm/file-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Rename failed", description: err.error, variant: "error" });
      return;
    }
    setRenaming(null);
    await onChanged();
    toast({ title: "Category renamed", variant: "success" });
  }

  async function remove(id: string, inUseCount: number) {
    if (inUseCount > 0) {
      toast({
        title: "Reassign files first",
        description: `${inUseCount} file(s) still use this category (BR-FI-6).`,
        variant: "error",
      });
      return;
    }
    if (!confirm("Delete category?")) return;
    const res = await fetch(`/api/pm/file-categories/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Delete failed", description: err.error, variant: "error" });
      return;
    }
    await onChanged();
    toast({ title: "Category deleted", variant: "success" });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title="Manage categories"
          description="The `Leases` category is system-seeded — it cannot be renamed or deleted. Other categories cannot be deleted while any file still references them (BR-FI-6)."
          onClose={onClose}
        />
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New category name"
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <Button onClick={add} disabled={saving || !newName.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <ul className="space-y-1 rounded border border-border bg-surface">
            {categories.map((c) => {
              const isEditing = renaming?.id === c.id;
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-2 border-b border-border/40 px-3 py-2 text-sm last:border-b-0"
                >
                  {isEditing ? (
                    <>
                      <Input
                        value={renaming.name}
                        onChange={(e) =>
                          setRenaming({ id: c.id, name: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") rename(c.id, renaming.name);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={() => rename(c.id, renaming.name)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRenaming(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-fg">
                        {c.name}
                        {c.systemSeeded && (
                          <span className="ml-2 rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-info">
                            System
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-fg-muted">
                        {c.inUseCount} files
                      </span>
                      {!c.systemSeeded && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setRenaming({ id: c.id, name: c.name })
                            }
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-error hover:text-error"
                            onClick={() => remove(c.id, c.inUseCount)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </li>
              );
            })}
            {categories.length === 0 && (
              <li className="px-3 py-3 text-sm text-fg-muted">
                No categories yet.
              </li>
            )}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit single-file metadata modal
// ---------------------------------------------------------------------------

function EditFileModal({
  open,
  onClose,
  row,
  categories,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  row: FileRow;
  categories: CategoryRow[];
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [title, setTitle] = React.useState(row.title);
  const [sharing, setSharing] = React.useState<FileSharing>(row.sharing);
  const [categoryId, setCategoryId] = React.useState(row.categoryId);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle(row.title);
      setSharing(row.sharing);
      setCategoryId(row.categoryId);
    }
  }, [open, row]);

  async function save() {
    setSaving(true);
    const body: Record<string, unknown> = {};
    if (title.trim() && title !== row.title) body.title = title.trim();
    if (sharing !== row.sharing) body.sharing = sharing;
    if (categoryId !== row.categoryId) body.categoryId = categoryId;
    if (Object.keys(body).length === 0) {
      setSaving(false);
      onClose();
      return;
    }
    const res = await fetch(`/api/pm/files/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Save failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "File updated", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title="Edit file"
          description="Renaming or recategorizing bumps lastModifiedAt — uploadedAt stays pinned to the original upload (BR-FI-4)."
          onClose={onClose}
        />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ef-title">Title</Label>
            <Input
              id="ef-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ef-cat">Category</Label>
            <select
              id="ef-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ef-share">Sharing</Label>
            <select
              id="ef-share"
              value={sharing}
              onChange={(e) => setSharing(e.target.value as FileSharing)}
              className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
            >
              {SHARING_VALUES.map((s) => (
                <option key={s} value={s}>
                  {SHARING_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk modals (move / sharing)
// ---------------------------------------------------------------------------

function BulkMoveModal({
  open,
  onClose,
  categories,
  selectedIds,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  categories: CategoryRow[];
  selectedIds: string[];
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [categoryId, setCategoryId] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setCategoryId("");
  }, [open]);

  async function save() {
    if (!categoryId) {
      toast({ title: "Pick a target category", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/files/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move",
        ids: selectedIds,
        categoryId,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Move failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Moved", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title={`Move ${selectedIds.length} file(s) to category`}
          onClose={onClose}
        />
        <div className="space-y-1">
          <Label htmlFor="bm-cat">Target category</Label>
          <select
            id="bm-cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
          >
            <option value="">Pick one…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !categoryId}>
            {saving ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkShareModal({
  open,
  onClose,
  selectedIds,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [sharing, setSharing] = React.useState<FileSharing>("Internal");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/pm/files/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "share",
        ids: selectedIds,
        sharing,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Update failed",
        description: err.error,
        variant: "error",
      });
      return;
    }
    toast({ title: "Sharing updated", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title={`Change sharing on ${selectedIds.length} file(s)`}
          description="Sharing only controls portal visibility — every PM in this org will still see every file regardless of Sharing (BR-FI-7)."
          onClose={onClose}
        />
        <div className="space-y-1">
          <Label htmlFor="bs-share">Sharing</Label>
          <select
            id="bs-share"
            value={sharing}
            onChange={(e) => setSharing(e.target.value as FileSharing)}
            className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
          >
            {SHARING_VALUES.map((s) => (
              <option key={s} value={s}>
                {SHARING_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
