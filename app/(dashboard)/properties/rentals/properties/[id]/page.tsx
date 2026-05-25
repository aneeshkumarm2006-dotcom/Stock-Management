// /properties/rentals/properties/[id] — Property detail.
// Tabs: Summary | Financials | Units | Tasks | Communications | Event
// history | Notes | Files.
// Tasks sub-tab (Phase 5) reuses the central Task store filtered by
// propertyId (§9 Q5 — "filtered view of the same store").
// Communications (Phase 6) queries EmailMessage rows with
// relatedEntityType='Property'; sending to a Property scope blasts to
// every active Tenant on the property (BR-CC-8 analogue).
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
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
import { CommunicationsTab } from "@/components/pm/CommunicationsTab";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { CustomFieldsRenderer } from "@/components/pm/CustomFieldsRenderer";
import { PropertyVacancyWidget } from "@/components/pm/PropertyVacancyWidget";
import {
  EntityImageGallery,
  type GalleryImage,
} from "@/components/pm/EntityImageGallery";
import type {
  PropertyClass,
  PropertySubType,
} from "@/types/pm";

interface OwnerRef {
  rentalOwnerId: string;
  ownershipPct: number;
  displayName: string;
}

interface BankRef {
  id: string;
  name: string;
  accountNumberMasked: string;
}

interface PropertyDetail {
  id: string;
  propertyName: string;
  propertyClass: PropertyClass;
  propertySubType: PropertySubType;
  address: {
    line1: string;
    line2?: string;
    line3?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  photo: string | null;
  images: GalleryImage[];
  propertyManagerUserId: string | null;
  rentalOwners: OwnerRef[];
  operatingAccount: BankRef | null;
  depositTrustAccount: BankRef | null;
  propertyReserve: number;
  listingDescription: string;
  amenities: string[];
  includedInRent: string[];
  residentCenterPaymentHistory: string;
  residentCenterRequests: { enabled: boolean; showEntryQuestions: boolean };
  residentCenterForums: boolean;
  rentersInsuranceMinLiability3rdParty: number | null;
  rentersInsuranceMinLiabilityMSI: number | null;
  customFields: Record<string, unknown>;
  active: boolean;
  cashBalance: number;
  securityDepositsHeld: number;
  availableCash: number;
}

interface UnitRow {
  id: string;
  unitId: string;
  bedrooms: number | null;
  bathrooms: string;
  sizeSqft: number | null;
  applianceCount: number;
}

interface ApplianceRollupRow {
  id: string;
  name: string;
  unitNumber: string;
  installedDate: string | null;
}

export default function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<PropertyDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [units, setUnits] = React.useState<UnitRow[]>([]);
  const [appliances, setAppliances] = React.useState<ApplianceRollupRow[]>([]);
  const [addUnitOpen, setAddUnitOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [pRes, uRes, aRes] = await Promise.all([
      fetch(`/api/pm/properties/${id}`),
      fetch(`/api/pm/units?propertyId=${id}`),
      fetch(`/api/pm/appliances?propertyId=${id}`),
    ]);
    if (pRes.ok) setDoc((await pRes.json()) as PropertyDetail);
    if (uRes.ok) setUnits((await uRes.json()) as UnitRow[]);
    if (aRes.ok) setAppliances((await aRes.json()) as ApplianceRollupRow[]);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function archive() {
    if (!doc) return;
    const res = await fetch(`/api/pm/properties/${doc.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast({ title: "Inactivate failed", variant: "error" });
      return;
    }
    toast({ title: "Inactivated", variant: "success" });
    await load();
  }

  async function reactivate() {
    if (!doc) return;
    const res = await fetch(`/api/pm/properties/${doc.id}/reactivate`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Reactivate failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Reactivated", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/rentals/properties")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Properties
        </Button>
        <div className="flex items-center gap-2">
          {doc.active ? (
            <Button variant="destructive" size="sm" onClick={archive}>
              Inactivate
            </Button>
          ) : (
            <Button size="sm" onClick={reactivate}>
              Reactivate
            </Button>
          )}
        </div>
      </div>

      {!doc.active && (
        <Card className="border-warning bg-warning/5">
          <CardContent className="py-3 text-sm text-warning">
            This property is inactive. Click <strong>Reactivate</strong> to
            restore it.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{doc.propertyName}</CardTitle>
          <span className="text-xs text-fg-muted">
            {doc.propertyClass} · {doc.propertySubType}
          </span>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="units">Units ({units.length})</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="events">Event history</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>

        {/* ------------------------------ Summary ------------------------------ */}
        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Address"
                  value={
                    <address className="not-italic text-sm text-fg">
                      <div>{doc.address.line1}</div>
                      {doc.address.line2 && <div>{doc.address.line2}</div>}
                      {doc.address.line3 && <div>{doc.address.line3}</div>}
                      <div>
                        {doc.address.city}, {doc.address.state}{" "}
                        {doc.address.zip}
                      </div>
                      {doc.address.country && doc.address.country !== "US" && (
                        <div>{doc.address.country}</div>
                      )}
                    </address>
                  }
                />
                <Field
                  label="Property manager"
                  value={doc.propertyManagerUserId ?? "Unassigned"}
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Photos</CardTitle>
            </CardHeader>
            <CardContent>
              <EntityImageGallery
                entityType="Property"
                entityId={doc.id}
                images={doc.images}
                coverId={doc.photo}
                parentEndpoint={`/api/pm/properties/${doc.id}`}
                onChanged={load}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vacancy</CardTitle>
            </CardHeader>
            <CardContent>
              <PropertyVacancyWidget propertyId={doc.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cash on hand (derived)</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-3">
                <Field
                  label="Operating cash"
                  value={<CurrencyAmount value={doc.cashBalance} />}
                />
                <Field
                  label="Security deposits held"
                  value={<CurrencyAmount value={doc.securityDepositsHeld} />}
                />
                <Field
                  label="Property reserve"
                  value={<CurrencyAmount value={doc.propertyReserve} />}
                />
                <Field
                  label="Available cash"
                  value={<CurrencyAmount value={doc.availableCash} />}
                />
              </dl>
              <p className="mt-3 text-xs italic text-fg-muted">
                Operating cash and security deposits roll up from Phase 2 ledger
                entries — currently zero until Phase 2 lands. Available cash =
                cash − deposits held − reserve (BR-PU-3).
              </p>
              <div
                className="mt-4 flex flex-wrap gap-2"
                title="Bulk charge/credit workflows post to the GL — wiring lands in Phase 2."
              >
                <Button size="sm" variant="outline" disabled>
                  Enter bulk charges
                </Button>
                <Button size="sm" variant="outline" disabled>
                  Enter bulk credits
                </Button>
                <span className="self-center text-xs italic text-fg-muted">
                  Phase 2
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rental owners</CardTitle>
            </CardHeader>
            <CardContent>
              {doc.rentalOwners.length === 0 ? (
                <p className="text-sm text-fg-muted">No owners attached.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Owner</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.rentalOwners.map((o) => (
                      <tr
                        key={o.rentalOwnerId}
                        className="border-b border-border/40"
                      >
                        <td className="py-2 text-fg">
                          <Link
                            href={`/properties/rentals/rental-owners/${o.rentalOwnerId}`}
                            className="hover:underline"
                          >
                            {o.displayName}
                          </Link>
                        </td>
                        <td className="text-fg-muted tabular-nums">
                          {o.ownershipPct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bank accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Operating"
                  value={
                    doc.operatingAccount ? (
                      <Link
                        href={`/properties/accounting/banking/${doc.operatingAccount.id}`}
                        className="hover:underline"
                      >
                        {doc.operatingAccount.name}{" "}
                        <span className="tabular-nums text-fg-muted">
                          {doc.operatingAccount.accountNumberMasked}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-amber-600">
                        Not configured —{" "}
                        <Link href="/properties/accounting/banking" className="underline">
                          Set up
                        </Link>
                      </span>
                    )
                  }
                />
                <Field
                  label="Deposit trust"
                  value={
                    doc.depositTrustAccount ? (
                      <Link
                        href={`/properties/accounting/banking/${doc.depositTrustAccount.id}`}
                        className="hover:underline"
                      >
                        {doc.depositTrustAccount.name}{" "}
                        <span className="tabular-nums text-fg-muted">
                          {doc.depositTrustAccount.accountNumberMasked}
                        </span>
                      </Link>
                    ) : (
                      <Link
                        href="/properties/accounting/banking"
                        className="font-bold text-primary hover:underline"
                      >
                        Setup →
                      </Link>
                    )
                  }
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resident Center</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Payment history"
                  value={doc.residentCenterPaymentHistory}
                />
                <Field
                  label="Requests"
                  value={
                    doc.residentCenterRequests.enabled
                      ? doc.residentCenterRequests.showEntryQuestions
                        ? "Enabled · with entry questions"
                        : "Enabled"
                      : "Disabled"
                  }
                />
                <Field
                  label="Forums"
                  value={doc.residentCenterForums ? "Enabled" : "Disabled"}
                />
                <Field
                  label="Min liability (3rd party)"
                  value={
                    doc.rentersInsuranceMinLiability3rdParty !== null ? (
                      <CurrencyAmount
                        value={doc.rentersInsuranceMinLiability3rdParty}
                      />
                    ) : (
                      "—"
                    )
                  }
                />
                <Field
                  label="Min liability (MSI)"
                  value={
                    doc.rentersInsuranceMinLiabilityMSI !== null ? (
                      <CurrencyAmount
                        value={doc.rentersInsuranceMinLiabilityMSI}
                      />
                    ) : (
                      "—"
                    )
                  }
                />
              </dl>
            </CardContent>
          </Card>

          {(doc.amenities.length > 0 || doc.includedInRent.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Amenities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {doc.amenities.length > 0 && (
                  <div>
                    <h5 className="mb-1 text-xs font-bold uppercase tracking-widest text-fg-muted">
                      Amenities
                    </h5>
                    <div className="flex flex-wrap gap-2">
                      {doc.amenities.map((a) => (
                        <span
                          key={a}
                          className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-fg"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {doc.includedInRent.length > 0 && (
                  <div>
                    <h5 className="mb-1 text-xs font-bold uppercase tracking-widest text-fg-muted">
                      Included in rent
                    </h5>
                    <div className="flex flex-wrap gap-2">
                      {doc.includedInRent.map((a) => (
                        <span
                          key={a}
                          className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-fg"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {appliances.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Appliances</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Appliance</th>
                      <th>Unit</th>
                      <th>Installed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appliances.map((a) => (
                      <tr key={a.id} className="border-b border-border/40">
                        <td className="py-2 text-fg">{a.name}</td>
                        <td className="text-fg-muted">{a.unitNumber}</td>
                        <td className="text-fg-muted">
                          {a.installedDate
                            ? new Date(a.installedDate).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {Object.keys(doc.customFields).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Custom fields</CardTitle>
              </CardHeader>
              <CardContent>
                <CustomFieldsRenderer
                  entityType="Property"
                  values={doc.customFields as Record<string, never>}
                  onChange={() => undefined}
                  disabled
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ----------------------------- Financials ---------------------------- */}
        <TabsContent value="financials" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Financials snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Operating cash"
                  value={<CurrencyAmount value={doc.cashBalance} />}
                />
                <Field
                  label="Trust cash"
                  value={<CurrencyAmount value={0} />}
                />
                <Field
                  label="Property reserve"
                  value={<CurrencyAmount value={doc.propertyReserve} />}
                />
                <Field
                  label="Available cash"
                  value={<CurrencyAmount value={doc.availableCash} />}
                />
                <Field
                  label="Outstanding balances"
                  value={<CurrencyAmount value={0} />}
                />
              </dl>
              <p className="text-xs italic text-fg-muted">
                Live figures wire up in Phase 2 once the General Ledger ships.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------- Units ------------------------------- */}
        <TabsContent value="units" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Units ({units.length})</CardTitle>
              <Button size="sm" onClick={() => setAddUnitOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add unit
              </Button>
            </CardHeader>
            <CardContent>
              {units.length === 0 ? (
                <p className="text-sm text-fg-muted">No units yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Unit</th>
                      <th>Beds</th>
                      <th>Baths</th>
                      <th>Size (sqft)</th>
                      <th>Appliances</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u) => (
                      <tr key={u.id} className="border-b border-border/40">
                        <td className="py-2 text-fg">
                          <Link
                            href={`/properties/rentals/properties/${doc.id}/units/${u.id}`}
                            className="font-medium hover:underline"
                          >
                            {u.unitId}
                          </Link>
                        </td>
                        <td className="text-fg-muted">{u.bedrooms ?? "—"}</td>
                        <td className="text-fg-muted">{u.bathrooms || "—"}</td>
                        <td className="text-fg-muted">{u.sizeSqft ?? "—"}</td>
                        <td className="text-fg-muted">{u.applianceCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          <AddUnitModal
            propertyId={doc.id}
            open={addUnitOpen}
            onClose={() => setAddUnitOpen(false)}
            onSaved={load}
          />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <PropertyTasksTab propertyId={doc.id} />
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <CommunicationsTab
            relatedEntityType="Property"
            relatedEntityId={doc.id}
          />
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <ActivityLog parentType="Property" parentId={doc.id} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="Property" parentId={doc.id} />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="Property" locationId={doc.id} />
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

function PropertyTasksTab({ propertyId }: { propertyId: string }) {
  // Phase 5 §9 Q5 — filtered view over the same central task store. Uses
  // /api/pm/tasks?propertyId=… so the rows match exactly what /properties/tasks
  // would show for the same scope. Past-due red rendering reuses the
  // `pastDue` flag returned by the API (BR-TP-6).
  interface Row {
    id: string;
    taskId: number;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    pastDue: boolean;
  }
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [includeTerminal, setIncludeTerminal] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const sp = new URLSearchParams();
    sp.set("propertyId", propertyId);
    if (includeTerminal) sp.set("includeTerminal", "1");
    const r = await fetch(`/api/pm/tasks?${sp.toString()}`);
    if (r.ok) setRows((await r.json()) as Row[]);
    setLoading(false);
  }, [propertyId, includeTerminal]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks ({rows.length})</CardTitle>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={includeTerminal}
              onChange={(e) => setIncludeTerminal(e.target.checked)}
            />
            Show closed
          </label>
          <Link
            href={`/properties/tasks?propertyId=${propertyId}`}
            className="text-xs text-fg-muted hover:underline"
          >
            Open in Tasks →
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-fg-muted">No tasks for this property.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">#</th>
                <th>Title</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-border/40">
                  <td className="py-2 font-mono text-xs text-fg-muted">
                    #{t.taskId}
                  </td>
                  <td>
                    <Link
                      href={`/properties/tasks/${t.id}`}
                      className="font-medium text-fg hover:underline"
                    >
                      {t.title}
                    </Link>
                  </td>
                  <td className="text-fg-muted">{t.status}</td>
                  <td className="text-fg-muted">{t.priority}</td>
                  <td
                    className={
                      t.pastDue
                        ? "font-bold text-error"
                        : "text-fg-muted"
                    }
                  >
                    {t.dueDate
                      ? new Date(t.dueDate).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function AddUnitModal({
  propertyId,
  open,
  onClose,
  onSaved,
}: {
  propertyId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    unitId: "",
    bedrooms: "",
    bathrooms: "",
    sizeSqft: "",
    description: "",
  });
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!form.unitId.trim()) {
      toast({ title: "Unit id required", variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/pm/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        unitId: form.unitId.trim(),
        bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
        bathrooms: form.bathrooms || undefined,
        sizeSqft: form.sizeSqft ? Number(form.sizeSqft) : undefined,
        description: form.description || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Unit added", variant: "success" });
    setForm({ unitId: "", bedrooms: "", bathrooms: "", sizeSqft: "", description: "" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title="Add unit" onClose={onClose} />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="u-id">Unit ID *</Label>
            <Input
              id="u-id"
              value={form.unitId}
              onChange={(e) => setForm({ ...form, unitId: e.target.value })}
              placeholder="A or 101"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="u-beds">Beds</Label>
              <Input
                id="u-beds"
                type="number"
                min={0}
                value={form.bedrooms}
                onChange={(e) =>
                  setForm({ ...form, bedrooms: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="u-baths">Baths</Label>
              <Input
                id="u-baths"
                value={form.bathrooms}
                onChange={(e) =>
                  setForm({ ...form, bathrooms: e.target.value })
                }
                placeholder="1.5"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="u-size">Sqft</Label>
              <Input
                id="u-size"
                type="number"
                min={0}
                value={form.sizeSqft}
                onChange={(e) =>
                  setForm({ ...form, sizeSqft: e.target.value })
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-desc">Description</Label>
            <textarea
              id="u-desc"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="min-h-[64px] w-full rounded border border-border bg-surface-highest px-3 py-2 text-sm text-fg"
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
