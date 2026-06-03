// /properties/rentals/tenants/[id] — Tenant detail (skeleton).
// Tabs: Summary | Communications | Event history | Notes | Files. Lease-
// binding card shows `--` placeholders with a Phase 3 footnote.
// Communications tab queries EmailMessage rows with relatedEntityType='Tenant'.
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ActivityLog } from "@/components/pm/ActivityLog";
import { NotesPanel } from "@/components/pm/NotesPanel";
import { FilesPanel } from "@/components/pm/FilesPanel";
import { CommunicationsTab } from "@/components/pm/CommunicationsTab";
import { InlineFieldEditor } from "@/components/pm/InlineFieldEditor";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { AssignLeaseModal } from "@/components/pm/AssignLeaseModal";
import { BreadcrumbOverride } from "@/components/layout/BreadcrumbOverride";
import { useToast } from "@/components/ui/toast";

interface Phone {
  number: string;
  smsOptIn: boolean;
}

interface TenantDetail {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phones: { mobile?: Phone; home?: Phone; work?: Phone; fax?: Phone };
  address: Record<string, string | undefined>;
  dateOfBirth: string | null;
  ssnLast4: string;
  cosignerFlag: boolean;
  residentCenterAccess: boolean;
  customFields: Record<string, unknown>;
  active: boolean;
  currentLeaseId: string | null;
  currentLease: {
    id: string;
    leaseNumber: number;
    propertyId: string;
    propertyName: string;
    unitId: string;
    unitName: string;
    status: string;
    leaseType: string;
    startDate: string | null;
    endDate: string | null;
    primaryRentAmount: number; // cents
  } | null;
}

const PHONE_KEYS = ["mobile", "home", "work", "fax"] as const;

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<TenantDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [assignOpen, setAssignOpen] = React.useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    return fetch(`/api/pm/tenants/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDoc(d as TenantDetail | null))
      .finally(() => setLoading(false));
  }, [id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function archive() {
    if (!doc) return;
    const leaseNote = doc.currentLeaseId
      ? " This tenant is linked to a current lease."
      : "";
    if (
      !window.confirm(
        `Inactivate ${doc.displayName}?${leaseNote} They will be removed from active tenant lists.`,
      )
    )
      return;
    const res = await fetch(`/api/pm/tenants/${doc.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Archive failed", variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    router.push("/properties/rentals/tenants");
  }

  async function endLease() {
    if (!doc?.currentLease) return;
    if (
      !window.confirm(
        `End the lease for ${doc.displayName} at ${doc.currentLease.propertyName} · ${doc.currentLease.unitName}? ` +
          "They will be moved out and the unit freed.",
      )
    )
      return;
    const res = await fetch(`/api/pm/leases/${doc.currentLease.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Ended" }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Couldn’t end lease",
        description: err.error,
        variant: "error",
      });
      return;
    }
    toast({ title: "Lease ended", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      {/* STATE-015: replace the leaf "Detail" breadcrumb crumb with the
          resolved tenant name once loaded. */}
      <BreadcrumbOverride label={doc.displayName} />
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/rentals/tenants")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Tenants
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={archive}
          disabled={!doc.active}
        >
          {doc.active ? "Inactivate" : "Inactive"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{doc.displayName}</CardTitle>
          {doc.cosignerFlag && (
            <span className="rounded bg-secondary-container/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
              Cosigner
            </span>
          )}
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="events">Event history</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent>
              <InlineFieldEditor
                endpoint={`/api/pm/tenants/${doc.id}`}
                data={{
                  firstName: doc.firstName,
                  lastName: doc.lastName,
                  email: doc.email,
                  dateOfBirth: doc.dateOfBirth,
                  ssnLast4: doc.ssnLast4,
                } as Record<string, unknown>}
                fields={[
                  { key: "firstName", label: "First name", required: true },
                  { key: "lastName", label: "Last name", required: true },
                  { key: "email", label: "Email", type: "email" },
                  { key: "dateOfBirth", label: "Date of birth", type: "date" },
                  {
                    key: "ssnLast4",
                    label: "SSN last 4",
                    placeholder: "1234",
                    display: (v) => (v ? `***-**-${v}` : "—"),
                  },
                ]}
                title="Tenant"
                canEdit={doc.active}
                onSaved={load}
              />
              <ul className="mt-3 space-y-1.5 text-sm text-fg">
                {PHONE_KEYS.map((key) => {
                  const p = doc.phones?.[key];
                  if (!p?.number) return null;
                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>
                        <span className="text-xs uppercase text-fg-muted">
                          {key}:
                        </span>{" "}
                        {p.number}
                        {p.smsOptIn && (
                          <span className="ml-2 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-bold text-success">
                            SMS opt-in
                          </span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          toast({
                            title: "Opt-in queued",
                            description:
                              "SMS dispatch lands in Phase 6 Communications.",
                            variant: "success",
                          })
                        }
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Send opt-in
                      </Button>
                    </li>
                  );
                })}
                {PHONE_KEYS.every((k) => !doc.phones?.[k]?.number) && (
                  <li className="text-fg-muted">No phones on file.</li>
                )}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lease</CardTitle>
              {doc.active &&
                (doc.currentLease ? (
                  <Button variant="destructive" size="sm" onClick={endLease}>
                    End lease / Move out
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setAssignOpen(true)}>
                    Assign to property
                  </Button>
                ))}
            </CardHeader>
            <CardContent>
              {doc.currentLease ? (
                <dl className="grid gap-3 md:grid-cols-2">
                  <Field
                    label="Property"
                    value={
                      <Link
                        href={`/properties/rentals/properties/${doc.currentLease.propertyId}`}
                        className="text-primary hover:underline"
                      >
                        {doc.currentLease.propertyName}
                      </Link>
                    }
                  />
                  <Field
                    label="Unit"
                    value={
                      <Link
                        href={`/properties/rentals/properties/${doc.currentLease.propertyId}/units/${doc.currentLease.unitId}`}
                        className="text-primary hover:underline"
                      >
                        {doc.currentLease.unitName}
                      </Link>
                    }
                  />
                  <Field
                    label="Lease"
                    value={`#${doc.currentLease.leaseNumber} · ${doc.currentLease.status}`}
                  />
                  <Field
                    label="Rent"
                    value={
                      <CurrencyAmount cents={doc.currentLease.primaryRentAmount} />
                    }
                  />
                  <Field
                    label="Start date"
                    value={
                      doc.currentLease.startDate
                        ? new Date(
                            doc.currentLease.startDate,
                          ).toLocaleDateString()
                        : "—"
                    }
                  />
                  <Field
                    label="End date"
                    value={
                      doc.currentLease.endDate
                        ? new Date(doc.currentLease.endDate).toLocaleDateString()
                        : doc.currentLease.leaseType === "At-will"
                          ? "At-will (no end date)"
                          : "—"
                    }
                  />
                </dl>
              ) : (
                <p className="text-sm text-fg-muted">
                  Not assigned to a property.
                  {doc.active
                    ? " Use “Assign to property” to place this tenant in a unit."
                    : ""}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <CommunicationsTab
            relatedEntityType="Tenant"
            relatedEntityId={doc.id}
          />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <ActivityLog parentType="Tenant" parentId={doc.id} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="Tenant" parentId={doc.id} />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="Tenant" locationId={doc.id} />
        </TabsContent>
      </Tabs>

      <AssignLeaseModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        presetTenant={{
          id: doc.id,
          firstName: doc.firstName,
          lastName: doc.lastName,
          email: doc.email,
        }}
        onSaved={async () => {
          setAssignOpen(false);
          await load();
        }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg">{value}</dd>
    </div>
  );
}
