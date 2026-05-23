// /properties/maintenance/vendors/[id] — detail page (PDR §3.11).
// Tabs: Summary | Financials | Communications | Files | Notes ([G-B-27]
// strip mirrors WorkOrder).
//   - Summary: contact + tax + insurance + portal opt-in (BR-MV-3, BR-MV-12).
//   - Financials: Transactions sub-tab reads JE rows where the vendor is
//     payee; ePay placeholder.
//   - Communications: polymorphic CommunicationsTab queries EmailMessage
//     rows where relatedEntityType='Vendor' (BR-MV-11).
//   - Files / Notes: shared polymorphic panels with parentType='Vendor'.
"use client";

import * as React from "react";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
import { VendorPortalActions } from "@/components/pm/VendorPortalActions";
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
interface VendorDetail {
  id: string;
  firstName: string;
  lastName: string;
  isCompany: boolean;
  companyName: string;
  displayName: string;
  categoryId: string | null;
  expenseAccountId: string | null;
  accountNumber: string;
  primaryEmail: string;
  alternateEmail: string;
  phones: {
    mobile?: Phone;
    home?: Phone;
    work?: Phone;
    fax?: Phone;
  };
  address: Address;
  website: string;
  comments: string;
  taxIdentityType: TaxIdentityType | null;
  taxpayerIdLast4: string;
  use1099AlternateName: boolean;
  alternativeName1099: string;
  use1099AlternateAddress: boolean;
  alternativeAddress1099: Address | null;
  insurance: {
    provider?: string;
    policyNumber?: string;
    expirationDate?: string | null;
  };
  daysUntilInsuranceExpires: number | null;
  customFields: Record<string, unknown>;
  vendorPortalAccess: boolean;
  active: boolean;
}

const PHONE_KEYS = ["mobile", "home", "work", "fax"] as const;

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<VendorDetail | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/vendors/${id}`);
    if (r.ok) setDoc((await r.json()) as VendorDetail);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  async function setActive(active: boolean) {
    if (!doc) return;
    const res = await fetch(`/api/pm/vendors/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (!res.ok) {
      toast({ title: active ? "Reactivate failed" : "Inactivate failed", variant: "error" });
      return;
    }
    toast({ title: active ? "Vendor reactivated" : "Vendor inactivated", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/maintenance/vendors")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Vendors
        </Button>
        {doc.active ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setActive(false)}
          >
            Inactivate
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setActive(true)}
          >
            Reactivate
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{doc.displayName}</CardTitle>
            {doc.daysUntilInsuranceExpires !== null &&
              doc.daysUntilInsuranceExpires < 0 && (
                <span className="ml-3 rounded bg-error/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-error">
                  Insurance expired
                </span>
              )}
            {doc.daysUntilInsuranceExpires !== null &&
              doc.daysUntilInsuranceExpires >= 0 &&
              doc.daysUntilInsuranceExpires <= 30 && (
                <span className="ml-3 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">
                  Insurance expires in {doc.daysUntilInsuranceExpires} days
                </span>
              )}
            {!doc.active && (
              <span className="ml-3 rounded bg-surface-high px-1.5 py-0.5 text-[10px] font-bold uppercase text-fg-muted">
                Inactive
              </span>
            )}
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 md:grid-cols-2">
                <Field label="Primary email" value={doc.primaryEmail || "—"} />
                <Field label="Alternate email" value={doc.alternateEmail || "—"} />
                <Field label="Website" value={doc.website || "—"} />
                <Field
                  label="Account number with vendor"
                  value={doc.accountNumber || "—"}
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
                      <li key={key}>
                        <span className="text-xs uppercase text-fg-muted">
                          {key}:
                        </span>{" "}
                        {p.number}
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
              <CardTitle>Insurance</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 md:grid-cols-2">
                <Field label="Provider" value={doc.insurance.provider || "—"} />
                <Field
                  label="Policy number"
                  value={doc.insurance.policyNumber || "—"}
                />
                <Field
                  label="Expiration date"
                  value={
                    doc.insurance.expirationDate
                      ? new Date(doc.insurance.expirationDate).toLocaleDateString()
                      : "—"
                  }
                />
              </dl>
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
                          doc.taxpayerIdLast4
                            ? ` ending ${doc.taxpayerIdLast4}`
                            : ""
                        }`
                      : "—"
                  }
                />
                <Field
                  label="1099 alt name"
                  value={
                    doc.use1099AlternateName
                      ? doc.alternativeName1099 || "—"
                      : "Off"
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

          <Card>
            <CardHeader>
              <CardTitle>Vendor portal</CardTitle>
            </CardHeader>
            <CardContent>
              <VendorPortalActions
                vendorId={doc.id}
                vendorPortalAccess={doc.vendorPortalAccess}
              />
            </CardContent>
          </Card>

          {Object.keys(doc.customFields).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Custom fields</CardTitle>
              </CardHeader>
              <CardContent>
                <CustomFieldsRenderer
                  entityType="Vendor"
                  values={doc.customFields as Record<string, never>}
                  onChange={() => undefined}
                  disabled
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="financials" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-fg-muted">
                Bill + payment activity for this vendor will surface here once
                the first Bill is recorded. Use the A/P Record bill modal on
                the Accounting → Bills page.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>ePay settings</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-fg-muted">
                ePay routing details land alongside Phase 9 Bank Feed
                integration.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <CommunicationsTab
            relatedEntityType="Vendor"
            relatedEntityId={doc.id}
          />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <FilesPanel locationType="Vendor" locationId={doc.id} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <NotesPanel parentType="Vendor" parentId={doc.id} />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Event history</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityLog parentType="Vendor" parentId={doc.id} />
        </CardContent>
      </Card>
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
