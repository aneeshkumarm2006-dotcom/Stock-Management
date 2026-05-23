// /properties/rentals/tenants/[id] — Tenant detail (skeleton).
// Tabs: Summary | Communications | Event history | Notes | Files. Lease-
// binding card shows `--` placeholders with a Phase 3 footnote.
// Communications tab queries EmailMessage rows with relatedEntityType='Tenant'.
"use client";

import * as React from "react";
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
}

const PHONE_KEYS = ["mobile", "home", "work", "fax"] as const;

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<TenantDetail | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch(`/api/pm/tenants/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDoc(d as TenantDetail | null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function archive() {
    if (!doc) return;
    const res = await fetch(`/api/pm/tenants/${doc.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Archive failed", variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    router.push("/properties/rentals/tenants");
  }

  return (
    <div className="space-y-4">
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
              <dl className="grid gap-3 md:grid-cols-2">
                <Field label="Email" value={doc.email || "—"} />
                <Field
                  label="Date of birth"
                  value={
                    doc.dateOfBirth
                      ? new Date(doc.dateOfBirth).toLocaleDateString()
                      : "—"
                  }
                />
                <Field
                  label="SSN"
                  value={doc.ssnLast4 ? `***-**-${doc.ssnLast4}` : "—"}
                />
                <Field
                  label="Resident Center"
                  value={doc.residentCenterAccess ? "Enabled" : "Disabled"}
                />
              </dl>
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
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field label="Current lease" value="—" />
                <Field label="Move-in date" value="—" />
                <Field label="Renters insurance" value="—" />
                <Field label="Balance" value="—" />
              </dl>
              <p className="mt-3 text-xs italic text-fg-muted">
                Lease bindings, balances, and insurance wire up in Phase 3.
              </p>
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
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg">{value}</dd>
    </div>
  );
}
