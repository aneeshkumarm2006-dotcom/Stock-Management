// /properties/rentals/properties/[id]/units/[unitId] — Unit detail.
// Tabs: Summary | Appliances | Event history | Notes | Files.
"use client";

import * as React from "react";
import Link from "next/link";
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
import { EditEntityButton } from "@/components/pm/EditEntityButton";
import { InlineFieldEditor } from "@/components/pm/InlineFieldEditor";
import { AssignLeaseModal } from "@/components/pm/AssignLeaseModal";

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
  currentTenants: Array<{
    tenantId: string;
    firstName: string;
    lastName: string;
    isCosigner: boolean;
  }>;
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
  const [editingApplianceId, setEditingApplianceId] = React.useState<
    string | undefined
  >();
  const [assignOpen, setAssignOpen] = React.useState(false);

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
              <InlineFieldEditor
                endpoint={`/api/pm/units/${doc.id}`}
                data={{
                  unitId: doc.unitId,
                  bedrooms: doc.bedrooms,
                  bathrooms: doc.bathrooms,
                  sizeSqft: doc.sizeSqft,
                  description: doc.description,
                } as Record<string, unknown>}
                fields={[
                  { key: "unitId", label: "Unit ID", required: true },
                  { key: "bedrooms", label: "Bedrooms", type: "number" },
                  { key: "bathrooms", label: "Bathrooms", placeholder: "e.g. 1.5" },
                  { key: "sizeSqft", label: "Size (sqft)", type: "number" },
                  {
                    key: "description",
                    label: "Description",
                    type: "textarea",
                  },
                ]}
                title="Unit"
                onSaved={load}
              />
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
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-fg-muted">
                    No tenant assigned to this unit yet.
                  </p>
                  <Button size="sm" onClick={() => setAssignOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Assign tenant to this unit
                  </Button>
                </div>
              ) : (
                <ul className="space-y-1 text-sm text-fg">
                  {doc.currentTenants.map((t) => (
                    <li key={t.tenantId}>
                      <Link
                        href={`/properties/rentals/tenants/${t.tenantId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {t.firstName} {t.lastName}
                      </Link>
                      {t.isCosigner && (
                        <span className="ml-2 text-xs text-fg-muted">
                          (cosigner)
                        </span>
                      )}
                    </li>
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
              <Button
                size="sm"
                onClick={() => {
                  setEditingApplianceId(undefined);
                  setAddApplianceOpen(true);
                }}
              >
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
                          <div className="inline-flex items-center gap-1">
                            <EditEntityButton
                              onClick={() => {
                                setEditingApplianceId(a.id);
                                setAddApplianceOpen(true);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => removeAppliance(a.id)}
                              className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
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
            editingId={editingApplianceId}
            onClose={() => {
              setAddApplianceOpen(false);
              setEditingApplianceId(undefined);
            }}
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

      <AssignLeaseModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        presetPropertyId={doc.propertyId}
        presetUnitId={doc.id}
        onSaved={async () => {
          setAssignOpen(false);
          await load();
        }}
      />
    </div>
  );
}

function AddApplianceModal({
  unitId,
  open,
  onClose,
  onSaved,
  editingId,
}: {
  unitId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  editingId?: string;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(editingId);
  const [name, setName] = React.useState("");
  const [installedDate, setInstalledDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (!editingId) {
      setName("");
      setInstalledDate("");
      return;
    }
    let cancelled = false;
    fetch(`/api/pm/appliances/${editingId}`).then(async (r) => {
      if (!r.ok || cancelled) return;
      const a = (await r.json()) as {
        name: string;
        installedDate: string | null;
      };
      if (cancelled) return;
      setName(a.name);
      setInstalledDate(a.installedDate ? a.installedDate.slice(0, 10) : "");
    });
    return () => {
      cancelled = true;
    };
  }, [open, editingId]);

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "error" });
      return;
    }
    setSaving(true);
    const url = isEdit
      ? `/api/pm/appliances/${editingId}`
      : "/api/pm/appliances";
    const method = isEdit ? "PATCH" : "POST";
    const payload: Record<string, unknown> = {
      name: name.trim(),
      installedDate: installedDate
        ? new Date(installedDate).toISOString()
        : null,
    };
    if (!isEdit) payload.unitId = unitId;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({
      title: isEdit ? "Appliance updated" : "Appliance added",
      variant: "success",
    });
    setName("");
    setInstalledDate("");
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title={isEdit ? "Edit appliance" : "Add appliance"}
          onClose={onClose}
        />
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
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
