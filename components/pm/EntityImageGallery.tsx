"use client";

// Polymorphic image gallery for Property and Unit detail pages.
//
// Upload flow mirrors `FilesPanel` (signed direct upload to Cloudinary):
//   1. POST /api/pm/files/sign → signed Cloudinary form fields.
//   2. Browser POSTs the binary directly to Cloudinary (image-only here).
//   3. POST /api/pm/files to record the PmFile row (locationType matches
//      the parent entity so it also appears under that entity's Files tab).
//   4. PATCH the parent entity's `images: [...existing, newFileId]` array.
//
// Removing an image only edits the parent's `images` array — the underlying
// PmFile row is preserved (still visible in Files tab, deletable from there).
// This keeps "delete" reversible and avoids cascading delete surprises.
import * as React from "react";
import { Trash2, Star, StarOff, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export interface GalleryImage {
  id: string;
  url: string;
  title: string;
  mimeType: string;
  originalFilename: string;
}

interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

interface FileCategory {
  id: string;
  name: string;
  systemSeeded: boolean;
}

interface Props {
  entityType: "Property" | "Unit";
  entityId: string;
  images: GalleryImage[];
  /** Currently-selected cover image id (Property only). */
  coverId?: string | null;
  /** Endpoint used to PATCH the parent (e.g. `/api/pm/properties/${id}`). */
  parentEndpoint: string;
  onChanged: () => void | Promise<void>;
}

export function EntityImageGallery({
  entityType,
  entityId,
  images,
  coverId,
  parentEndpoint,
  onChanged,
}: Props) {
  const { toast } = useToast();
  const [uploading, setUploading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Resolve the "Photos" category once. Seed adds it on org creation;
  // for legacy orgs that pre-date the seed change, fall back to the first
  // available category so the upload still succeeds.
  const [photosCategoryId, setPhotosCategoryId] = React.useState<string | null>(
    null,
  );
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/file-categories")
      .then((r) => (r.ok ? r.json() : []))
      .then((cats: FileCategory[]) => {
        if (cancelled) return;
        const photos = cats.find((c) => c.name === "Photos");
        setPhotosCategoryId(photos?.id ?? cats[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function uploadOne(file: File): Promise<string | null> {
    if (!file.type.startsWith("image/")) {
      toast({
        title: `Skipped ${file.name}`,
        description: "Only image files can be added to the gallery.",
        variant: "error",
      });
      return null;
    }
    if (!photosCategoryId) {
      toast({
        title: "Categories not loaded",
        description: "Try again in a moment.",
        variant: "error",
      });
      return null;
    }

    // 1. Get signed Cloudinary payload.
    const signRes = await fetch("/api/pm/files/sign", { method: "POST" });
    if (!signRes.ok) {
      const err = (await signRes.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Storage not ready",
        description: err.error ?? "Could not get upload signature.",
        variant: "error",
      });
      return null;
    }
    const sig = (await signRes.json()) as SignedUpload;

    // 2. Direct-upload binary to Cloudinary.
    const cloudForm = new FormData();
    cloudForm.append("file", file);
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
      toast({
        title: "Upload failed",
        description: err.error?.message,
        variant: "error",
      });
      return null;
    }
    const cloud = (await cloudRes.json()) as {
      public_id: string;
      secure_url: string;
      bytes: number;
      resource_type: "image" | "video" | "raw";
    };

    // 3. Record the PmFile (locationType = parent entity).
    const metaRes = await fetch("/api/pm/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: file.name,
        sharing: "Internal",
        categoryId: photosCategoryId,
        locationType: entityType,
        locationId: entityId,
        mimeType: file.type || "image/jpeg",
        originalFilename: file.name,
        fileSize: cloud.bytes || file.size,
        storageKey: cloud.public_id,
        storageUrl: cloud.secure_url,
        resourceType: cloud.resource_type,
      }),
    });
    if (!metaRes.ok) {
      const err = (await metaRes.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Save failed", description: err.error, variant: "error" });
      return null;
    }
    const created = (await metaRes.json()) as { id: string };
    return created.id;
  }

  async function onFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      const newIds: string[] = [];
      for (const f of Array.from(list)) {
        const id = await uploadOne(f);
        if (id) newIds.push(id);
      }
      if (newIds.length === 0) return;
      const nextIds = [...images.map((i) => i.id), ...newIds];
      const patchRes = await fetch(parentEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: nextIds }),
      });
      if (!patchRes.ok) {
        const err = (await patchRes.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Attach failed",
          description: err.error,
          variant: "error",
        });
        return;
      }
      toast({
        title: `Added ${newIds.length} image${newIds.length === 1 ? "" : "s"}`,
        variant: "success",
      });
      await onChanged();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      const nextIds = images.filter((i) => i.id !== id).map((i) => i.id);
      const res = await fetch(parentEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: nextIds }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Remove failed",
          description: err.error,
          variant: "error",
        });
        return;
      }
      toast({ title: "Image removed", variant: "success" });
      await onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function setCover(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(parentEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: id }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Update failed",
          description: err.error,
          variant: "error",
        });
        return;
      }
      toast({ title: "Cover updated", variant: "success" });
      await onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-muted">
          {images.length === 0
            ? "No images yet."
            : `${images.length} image${images.length === 1 ? "" : "s"}.`}
          {entityType === "Property" && images.length > 0 && (
            <span className="ml-1">The starred image is used as the cover.</span>
          )}
        </p>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onFilesPicked(e.target.files)}
          />
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "Uploading…" : "Upload images"}
          </Button>
        </div>
      </div>

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((img) => {
            const isCover = entityType === "Property" && coverId === img.id;
            const busy = busyId === img.id;
            return (
              <li
                key={img.id}
                className="group relative overflow-hidden rounded border border-border bg-surface"
              >
                <a
                  href={img.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square w-full"
                >
                  {/* Cloudinary URLs are external — Next/Image would require
                      domain config, so use a plain <img> for portability. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.title || img.originalFilename}
                    className="h-full w-full object-cover transition group-hover:opacity-90"
                    loading="lazy"
                  />
                </a>
                {isCover && (
                  <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
                    <Star className="h-3 w-3" /> Cover
                  </span>
                )}
                <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  {entityType === "Property" && !isCover && (
                    <button
                      type="button"
                      onClick={() => setCover(img.id)}
                      disabled={busy}
                      className="rounded bg-black/60 p-1 text-white hover:bg-black/80 disabled:opacity-50"
                      aria-label="Set as cover"
                      title="Set as cover"
                    >
                      <StarOff className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(img.id)}
                    disabled={busy}
                    className="rounded bg-black/60 p-1 text-white hover:bg-error hover:text-white disabled:opacity-50"
                    aria-label="Remove image"
                    title="Remove from gallery"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="truncate px-2 py-1 text-[11px] text-fg-muted">
                  {img.title || img.originalFilename}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default EntityImageGallery;
