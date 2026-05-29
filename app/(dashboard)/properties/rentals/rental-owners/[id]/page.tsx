// /properties/rentals/rental-owners/[id] — detail page.
// Tabs: Summary | Properties owned | Communications | Event history | Notes | Files.
// `Properties owned` is derived from the Property.rentalOwners[] junction.
// Communications tab queries EmailMessage rows with relatedEntityType='RentalOwner'.
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
import { CustomFieldsRenderer } from "@/components/pm/CustomFieldsRenderer";
import { InlineFieldEditor } from "@/components/pm/InlineFieldEditor";
import { useToast } from "@/components/ui/toast";
import type { TaxIdentityType } from "@/types/pm";

interface Phone {
  number: string;
  smsOptIn: boolean;
}
interface Address {
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}
interface OwnerDetail {
  id: string;
  firstName: string;
  lastName: string;
  isCompany: boolean;
  companyName: string;
  displayName: string;
  dateOfBirth: string | null;
  managementAgreement: {
    startDate: string | null;
    endDate: string | null;
  };
  daysUntilAgreementEnds: number | null;
  primaryEmail: string;
  alternateEmail: string;
  phones: {
    mobile?: Phone;
    home?: Phone;
    work?: Phone;
    fax?: Phone;
  };
  address: Address;
  comments: string;
  taxIdentityType: TaxIdentityType | null;
  taxpayerIdLast4: string;
  use1099AlternateName: boolean;
  alternativeName1099: string;
  use1099AlternateAddress: boolean;
  alternativeAddress1099: Address | null;
  customFields: Record<string, unknown>;
  active: boolean;
  propertiesOwned: Array<{
    propertyId: string;
    propertyName: string;
    ownershipPct: number;
  }>;
}

const PHONE_KEYS = ["mobile", "home", "work", "fax"] as const;

export default function RentalOwnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<OwnerDetail | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/rental-owners/${id}`);
    if (r.ok) setDoc((await r.json()) as OwnerDetail);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function archive() {
    if (!doc) return;
    const res = await fetch(`/api/pm/rental-owners/${doc.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast({ title: "Archive failed", variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    router.push("/properties/rentals/rental-owners");
  }

  function sendOptIn() {
    // SMS dispatch wires through Communications (Phase 6). For now this is
    // a UI affordance that records intent via toast; the actual provider
    // call lands when EmailMessage / TextMessage entities ship.
    toast({
      title: "Opt-in queued",
      description: "SMS dispatch lands in Phase 6 Communications.",
      variant: "success",
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/rentals/rental-owners")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Rental owners
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
          <div>
            <CardTitle>{doc.displayName}</CardTitle>
            {doc.daysUntilAgreementEnds !== null &&
              doc.daysUntilAgreementEnds <= 90 && (
                <span className="ml-3 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">
                  Agreement ends in {doc.daysUntilAgreementEnds} days
                </span>
              )}
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="properties">Properties owned</TabsTrigger>
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
            <CardContent className="space-y-4">
              <InlineFieldEditor
                endpoint={`/api/pm/rental-owners/${doc.id}`}
                data={{
                  firstName: doc.firstName,
                  lastName: doc.lastName,
                  primaryEmail: doc.primaryEmail,
                  alternateEmail: doc.alternateEmail,
                  dateOfBirth: doc.dateOfBirth,
                  comments: doc.comments,
                } as Record<string, unknown>}
                fields={[
                  { key: "firstName", label: "First name", required: true },
                  { key: "lastName", label: "Last name", required: true },
                  { key: "primaryEmail", label: "Primary email", type: "email" },
                  {
                    key: "alternateEmail",
                    label: "Alternate email",
                    type: "email",
                  },
                  { key: "dateOfBirth", label: "Date of birth", type: "date" },
                  { key: "comments", label: "Comments", type: "textarea" },
                ]}
                title="Rental owner"
                canEdit={doc.active}
                onSaved={load}
              />
              <dl className="mt-4 grid gap-3 md:grid-cols-2">
                <Field
                  label="Agreement"
                  value={
                    doc.managementAgreement.startDate ||
                    doc.managementAgreement.endDate
                      ? `${
                          doc.managementAgreement.startDate
                            ? new Date(
                                doc.managementAgreement.startDate,
                              ).toLocaleDateString()
                            : "—"
                        } → ${
                          doc.managementAgreement.endDate
                            ? new Date(
                                doc.managementAgreement.endDate,
                              ).toLocaleDateString()
                            : "—"
                        }`
                      : "—"
                  }
                />
              </dl>
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-fg-muted">
                  Phones
                </h4>
                <ul className="space-y-1.5 text-sm text-fg">
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
                          onClick={() => sendOptIn()}
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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Address</CardTitle>
            </CardHeader>
            <CardContent>
              <AddressDisplay address={doc.address} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>1099 / tax</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Tax identity"
                  value={
                    doc.taxIdentityType
                      ? `${doc.taxIdentityType}${
                          doc.taxpayerIdLast4 ? ` ending ${doc.taxpayerIdLast4}` : ""
                        }`
                      : "—"
                  }
                />
                <Field
                  label="1099 alt name"
                  value={
                    doc.use1099AlternateName ? doc.alternativeName1099 || "—" : "Off"
                  }
                />
                <Field
                  label="1099 alt address"
                  value={
                    doc.use1099AlternateAddress
                      ? doc.alternativeAddress1099
                        ? formatAddress(doc.alternativeAddress1099)
                        : "—"
                      : "Off"
                  }
                />
              </dl>
            </CardContent>
          </Card>

          {Object.keys(doc.customFields).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Custom fields</CardTitle>
              </CardHeader>
              <CardContent>
                <CustomFieldsRenderer
                  entityType="RentalOwner"
                  values={doc.customFields as Record<string, never>}
                  onChange={() => undefined}
                  disabled
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="properties" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Properties owned</CardTitle>
            </CardHeader>
            <CardContent>
              {doc.propertiesOwned.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No properties yet. Attach this owner from a property&apos;s
                  edit form.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="py-2">Property</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.propertiesOwned.map((p) => (
                      <tr
                        key={p.propertyId}
                        className="border-b border-border/40"
                      >
                        <td className="py-2 text-fg">
                          <Link
                            href={`/properties/rentals/properties/${p.propertyId}`}
                            className="hover:underline"
                          >
                            {p.propertyName}
                          </Link>
                        </td>
                        <td className="text-fg-muted tabular-nums">
                          {p.ownershipPct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <CommunicationsTab
            relatedEntityType="RentalOwner"
            relatedEntityId={doc.id}
          />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <ActivityLog parentType="RentalOwner" parentId={doc.id} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="RentalOwner" parentId={doc.id} />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="RentalOwner" locationId={doc.id} />
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

function AddressDisplay({ address }: { address: Address }) {
  if (!address || !address.line1) {
    return <span className="text-sm text-fg-muted">No address on file.</span>;
  }
  return (
    <address className="not-italic text-sm text-fg">
      <div>{address.line1}</div>
      {address.line2 && <div>{address.line2}</div>}
      {address.line3 && <div>{address.line3}</div>}
      <div>
        {address.city ? `${address.city}, ` : ""}
        {address.state ?? ""} {address.zip ?? ""}
      </div>
      {address.country && address.country !== "US" && <div>{address.country}</div>}
    </address>
  );
}

function formatAddress(a: Address): string {
  return [a.line1, a.city, a.state, a.zip].filter(Boolean).join(", ");
}
