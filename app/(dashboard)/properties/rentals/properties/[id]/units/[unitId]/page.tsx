// /properties/rentals/properties/[id]/units/[unitId] — Unit detail.
// Tabs: Summary | Appliances | Event history | Notes | Files.
"use client";

import * as React from "react";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ActivityLog } from "@/components/pm/ActivityLog";
import { NotesPanel } from "@/components/pm/NotesPanel";
import { FilesPanel } from "@/components/pm/FilesPanel";
import {
  EntityImageGallery,
  type GalleryImage,
} from "@/components/pm/EntityImageGallery";

interface UnitDetail {
  id: string;
  propertyId: string;
  propertyName: string;
  address: {
    line1?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  unitId: string;
  bedrooms: number | null;
  bathrooms: string;
  sizeSqft: number | null;
  description: string;
  amenities: string[];
  images: GalleryImage[];
  currentTenants: Array<{ id: string; displayName: string }>;
  mostRecentEvent: { eventType: string; createdAt: string } | null;
}

interface ApplianceRow {
  id: string;
  name: string;
  installedDate: string | null;
  unitId: string;
}

export default function UnitDetailPage() {
  const params = useParams<{ id: string; unitId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<UnitDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [appliances, setAppliances] = React.useState<ApplianceRow[]>([]);
  const [addApplianceOpen, setAddApplianceOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [uRes, aRes] = await Promise.all([
      fetch(`/api/pm/units/${params.unitId}`),
      fetch(`/api/pm/appliances?unitId=${params.unitId}`),
    ]);
    if (uRes.ok) setDoc((await uRes.json()) as UnitDetail);
    if (aRes.ok) setAppliances((await aRes.json()) as ApplianceRow[]);
    setLoading(false);
  }, [params.unitId]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function removeUnit() {
    const res = await fetch(`/api/pm/units/${params.unitId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast({ title: "Delete failed", variant: "error" });
      return;
    }
    toast({ title: "Unit deleted", variant: "success" });
    router.push(`/properties/rentals/properties/${params.id}`);
  }

  async function removeAppliance(id: string) {
    const res = await fetch(`/api/pm/appliances/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Delete failed", variant: "error" });
      return;
    }
    toast({ title: "Removed", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/properties/rentals/properties/${params.id}`)}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {doc.propertyName}
        </Button>
        <Button variant="destructive" size="sm" onClick={removeUnit}>
          Delete unit
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unit {doc.unitId}</CardTitle>
          <span className="text-xs text-fg-muted">
            {doc.address?.line1
              ? `${doc.address.line1}, ${doc.address.city ?? ""} ${doc.address.state ?? ""}`
              : "Address from parent property"}
          </span>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="appliances">
            Appliances ({appliances.length})
          </TabsTrigger>
          <TabsTrigger value="events">Event history</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Specs</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-3">
                <Field label="Bedrooms" value={doc.bedrooms ?? "—"} />
                <Field label="Bathrooms" value={doc.bathrooms || "—"} />
                <Field
                  label="Size (sqft)"
                  value={doc.sizeSqft ?? "—"}
                />
              </dl>
              {doc.description && (
                <p className="mt-3 text-sm text-fg">{doc.description}</p>
              )}
              {doc.amenities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {doc.amenities.map((a) => (
                    <span
                      key={a}
                      className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-fg"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Photos</CardTitle>
            </CardHeader>
            <CardContent>
              <EntityImageGallery
                entityType="Unit"
                entityId={doc.id}
                images={doc.images}
                parentEndpoint={`/api/pm/units/${doc.id}`}
                onChanged={load}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tenants</CardTitle>
            </CardHeader>
            <CardContent>
              {doc.currentTenants.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No active tenants. Lease bindings wire up in Phase 3.
                </p>
              ) : (
                <ul className="space-y-1 text-sm text-fg">
                  {doc.currentTenants.map((t) => (
                    <li key={t.id}>{t.displayName}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {doc.mostRecentEvent && (
            <Card>
              <CardHeader>
                <CardTitle>Most recent event</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-fg">
                  {doc.mostRecentEvent.eventType}{" "}
                  <span className="text-xs text-fg-muted">
                    {new Date(doc.mostRecentEvent.createdAt).toLocaleString()}
                  </span>
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="appliances" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Appliances</CardTitle>
              <Button size="sm" onClick={() => setAddApplianceOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add appliance
              </Button>
            </CardHeader>
            <CardContent>
              {appliances.length === 0 ? (
                <p className="text-sm text-fg-muted">No appliances yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Name</th>
                      <th>Installed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {appliances.map((a) => (
                      <tr key={a.id} className="border-b border-border/40">
                        <td className="py-2 text-fg">{a.name}</td>
                        <td className="text-fg-muted">
                          {a.installedDate
                            ? new Date(a.installedDate).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => removeAppliance(a.id)}
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
              )}
            </CardContent>
          </Card>
          <AddApplianceModal
            unitId={doc.id}
            open={addApplianceOpen}
            onClose={() => setAddApplianceOpen(false)}
            onSaved={load}
          />
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <ActivityLog parentType="Unit" parentId={doc.id} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="Unit" parentId={doc.id} />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="Unit" locationId={doc.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg">{value}</dd>
    </div>
  );
}

function AddApplianceModal({
  unitId,
  open,
  onClose,
  onSaved,
}: {
  unitId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [installedDate, setInstalledDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/appliances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unitId,
        name: name.trim(),
        installedDate: installedDate
          ? new Date(installedDate).toISOString()
          : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Appliance added", variant: "success" });
    setName("");
    setInstalledDate("");
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title="Add appliance" onClose={onClose} />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="a-name">Name *</Label>
            <Input
              id="a-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Refrigerator"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-installed">Installed date</Label>
            <Input
              id="a-installed"
              type="date"
              value={installedDate}
              onChange={(e) => setInstalledDate(e.target.value)}
            />
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
