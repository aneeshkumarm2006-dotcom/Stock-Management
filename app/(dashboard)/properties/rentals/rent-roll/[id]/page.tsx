// /properties/rentals/rent-roll/[id] — Lease detail.
// Tabs: Summary | Financials | Tenant | Communications | Event history.
// Includes EVICTION PENDING overlay (BR-LL-3), 90-day chip (BR-LL-5),
// renters insurance + pets sections, and the Renew lease button gated by
// [G-B-8]. Communications tab (Phase 6) queries EmailMessage rows with
// relatedEntityType='Lease'; sending to a Lease scope blasts to every
// tenant on that lease.
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ActivityLog } from "@/components/pm/ActivityLog";
import { NotesPanel } from "@/components/pm/NotesPanel";
import { FilesPanel } from "@/components/pm/FilesPanel";
import { CommunicationsTab } from "@/components/pm/CommunicationsTab";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { EvictionToggleDialog } from "@/components/pm/EvictionToggleDialog";
import { RentersInsuranceModal } from "@/components/pm/RentersInsuranceModal";
import { PetModal } from "@/components/pm/PetModal";
import { EditLeaseModal } from "@/components/pm/EditLeaseModal";
import { EditEntityButton } from "@/components/pm/EditEntityButton";
import { tenantDisplayName } from "@/lib/pm/tenantName";
import { formatDateOnly } from "@/lib/utils/dateInput";
import type { TenantType } from "@/types/pm";

interface LeaseDetail {
  id: string;
  leaseNumber: number;
  propertyId: string;
  unitId: string;
  tenants: Array<{
    tenantId: string;
    tenantType?: TenantType;
    firstName: string;
    lastName: string;
    companyName?: string;
    email: string;
    isCosigner: boolean;
  }>;
  cosigners: Array<{
    tenantId: string;
    tenantType?: TenantType;
    firstName: string;
    lastName: string;
    companyName?: string;
  }>;
  leaseType: string;
  startDate: string;
  endDate: string | null;
  status: string;
  derivedStatus: string;
  evictionPending: boolean;
  evictionPendingNote: string;
  daysRemaining: number | null;
  rentCycle: string;
  primaryRent: {
    amount: number;
    nextDueDate: string | null;
    memo: string;
  };
  splitRentCharges: Array<{ amount: number; memo: string }>;
  securityDeposit: {
    received: number;
    withheld: number;
    refunded: number;
    held: number;
  };
  recurringCharges: Array<{
    id: string;
    amount: number;
    frequency: string;
    memo: string;
    nextDate: string | null;
  }>;
  oneTimeCharges: Array<{
    id: string;
    amount: number;
    memo: string;
    dueDate: string | null;
    posted: boolean;
  }>;
  rentersInsurancePolicies: Array<{
    id: string;
    carrier: string;
    policyNumber: string;
    liabilityCoverage: number;
    effectiveDate: string;
    expirationDate: string;
  }>;
  uninsuredResidents: Array<{
    tenantId: string;
    tenantType?: TenantType;
    firstName: string;
    lastName: string;
    companyName?: string;
  }>;
  pets: Array<{
    id: string;
    name: string;
    petType: string;
    breed: string;
    assistanceAnimal: boolean;
  }>;
  esignatureDocuments: Array<{ id: string; label: string; status: string }>;
  promotedFromDraftLeaseId: string | null;
  residentCenterWelcomeEmail: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default function LeaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = React.useState<LeaseDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [evictionOpen, setEvictionOpen] = React.useState(false);
  const [insuranceOpen, setInsuranceOpen] = React.useState(false);
  const [insuranceEditingId, setInsuranceEditingId] = React.useState<
    string | undefined
  >();
  const [petOpen, setPetOpen] = React.useState(false);
  const [petEditingId, setPetEditingId] = React.useState<string | undefined>();
  const [editLeaseOpen, setEditLeaseOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/leases/${params.id}`);
    if (r.status === 404) {
      notFound();
      return;
    }
    if (r.ok) setData((await r.json()) as LeaseDetail);
    setLoading(false);
  }, [params.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) return <div className="p-4 text-fg-muted">Loading…</div>;

  const renewEligible =
    (data.status === "Active" || data.status === "Expired") &&
    (data.leaseType === "At-will" ||
      (data.endDate &&
        new Date(data.endDate).getTime() <= Date.now() + 90 * DAY_MS));

  async function renew() {
    const res = await fetch(`/api/pm/leases/${data!.id}/renewal`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Renewal failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    const result = (await res.json()) as { draftLeaseId: string };
    toast({ title: "Renewal draft created" });
    router.push(`/properties/leasing/draft-leases/${result.draftLeaseId}`);
  }

  async function postRecurring() {
    const res = await fetch(
      `/api/pm/leases/${data!.id}/post-recurring-charges`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    if (!res.ok) {
      toast({ title: "Post failed", variant: "error" });
      return;
    }
    const result = (await res.json()) as {
      postedCount: number;
      skipped: { reason: string }[];
    };
    toast({
      title: `Posted ${result.postedCount} charge(s)`,
      description:
        result.skipped.length > 0
          ? `${result.skipped.length} skipped (locked period)`
          : undefined,
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/properties/rentals/rent-roll">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Rent roll
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Lease #{data.leaseNumber}</h1>
        <Badge
          variant={
            data.status === "Active"
              ? "gain"
              : data.status === "Future"
                ? "muted"
                : "outline"
          }
        >
          {data.status}
        </Badge>
        {data.daysRemaining != null && (
          <Badge variant="loss">{data.daysRemaining}d remaining</Badge>
        )}
        {data.evictionPending && (
          <Badge variant="loss">EVICTION PENDING</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditLeaseOpen(true)}
          >
            Edit lease
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEvictionOpen(true)}
          >
            {data.evictionPending
              ? "Clear eviction pending"
              : "Flag eviction pending"}
          </Button>
          <Button
            size="sm"
            onClick={renew}
            disabled={!renewEligible}
            title={!renewEligible ? "Renewal requires Active/Expired + ≤ 90 days remaining" : ""}
          >
            Renew lease
          </Button>
        </div>
      </div>

      {data.evictionPending && data.evictionPendingNote && (
        <div className="rounded border border-loss/40 bg-loss/5 px-3 py-2 text-sm text-loss">
          {data.evictionPendingNote}
        </div>
      )}

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="tenant">Tenant</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="history">Event history</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Terms</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-fg-muted">Lease type</div>
                    <div>{data.leaseType}</div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Cycle</div>
                    <div>{data.rentCycle}</div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Start date</div>
                    <div>{formatDateOnly(data.startDate)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">End date</div>
                    <div>
                      {data.endDate
                        ? formatDateOnly(data.endDate)
                        : "(At-will)"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">
                      Total monthly rent
                    </div>
                    <div>
                      <CurrencyAmount
                        cents={
                          data.primaryRent.amount +
                          data.splitRentCharges.reduce(
                            (s, c) => s + c.amount,
                            0,
                          )
                        }
                      />
                    </div>
                    {/* §4 — Base + OPEX/Tax breakdown so the composition is clear. */}
                    <div className="mt-0.5 space-y-0.5 text-xs text-fg-muted">
                      <div>
                        Base <CurrencyAmount cents={data.primaryRent.amount} />
                        {data.primaryRent.memo ? ` · ${data.primaryRent.memo}` : ""}
                      </div>
                      {data.splitRentCharges.map((c, i) => (
                        <div key={i}>
                          {c.memo || "Recovery"}{" "}
                          <CurrencyAmount cents={c.amount} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Next due</div>
                    <div>
                      {data.primaryRent.nextDueDate
                        ? new Date(data.primaryRent.nextDueDate).toLocaleDateString()
                        : "—"}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-fg-muted">Security deposit</div>
                    <div className="flex gap-4">
                      <span>
                        Received{" "}
                        <CurrencyAmount cents={data.securityDeposit.received} />
                      </span>
                      <span>
                        Withheld{" "}
                        <CurrencyAmount cents={data.securityDeposit.withheld} />
                      </span>
                      <span>
                        Refunded{" "}
                        <CurrencyAmount cents={data.securityDeposit.refunded} />
                      </span>
                      <span className="font-medium">
                        Held <CurrencyAmount cents={data.securityDeposit.held} />
                      </span>
                    </div>
                    <div className="text-xs text-fg-muted">
                      BR-LL-4 — Current = Received − Withheld − Refunded
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Renters insurance</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => {
                      setInsuranceEditingId(undefined);
                      setInsuranceOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add policy
                  </Button>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  {data.uninsuredResidents.length > 0 && (
                    <div className="text-xs text-loss">
                      Uninsured residents:{" "}
                      {data.uninsuredResidents
                        .map((r) => tenantDisplayName(r))
                        .join(", ")}{" "}
                      (BR-LL-6)
                    </div>
                  )}
                  {data.rentersInsurancePolicies.length === 0 ? (
                    <p className="text-fg-muted">No active policies.</p>
                  ) : (
                    <table className="w-full">
                      <thead className="text-xs uppercase text-fg-muted border-b border-border">
                        <tr>
                          <th className="py-1 text-left">Carrier</th>
                          <th>Policy #</th>
                          <th>Liability</th>
                          <th>Effective</th>
                          <th>Expires</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.rentersInsurancePolicies.map((p) => (
                          <tr key={p.id} className="border-b border-border/40">
                            <td className="py-1">{p.carrier}</td>
                            <td className="text-fg-muted">
                              {p.policyNumber || "—"}
                            </td>
                            <td>
                              <CurrencyAmount cents={p.liabilityCoverage} />
                            </td>
                            <td className="text-fg-muted">
                              {new Date(p.effectiveDate).toLocaleDateString()}
                            </td>
                            <td className="text-fg-muted">
                              {new Date(p.expirationDate).toLocaleDateString()}
                            </td>
                            <td className="text-right">
                              <EditEntityButton
                                onClick={() => {
                                  setInsuranceEditingId(p.id);
                                  setInsuranceOpen(true);
                                }}
                              />
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
                  <CardTitle>Pets</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => {
                      setPetEditingId(undefined);
                      setPetOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add pet
                  </Button>
                </CardHeader>
                <CardContent className="text-sm">
                  {data.pets.length === 0 ? (
                    <p className="text-fg-muted">No pets attached.</p>
                  ) : (
                    <ul className="space-y-1">
                      {data.pets.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between"
                        >
                          <span>
                            {p.name} · {p.petType}
                            {p.breed ? ` (${p.breed})` : ""}
                            {p.assistanceAnimal && (
                              <Badge variant="outline" className="ml-2">
                                Assistance
                              </Badge>
                            )}
                          </span>
                          <EditEntityButton
                            onClick={() => {
                              setPetEditingId(p.id);
                              setPetOpen(true);
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <NotesPanel parentType="Lease" parentId={data.id} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Files</CardTitle>
                </CardHeader>
                <CardContent>
                  <FilesPanel locationType="Lease" locationId={data.id} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Resident Center</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-fg-muted">
                  Welcome email:{" "}
                  {data.residentCenterWelcomeEmail ? "ON" : "OFF (default)"} —
                  TODO Phase 6 dispatches.
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="financials">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recurring charges</CardTitle>
                <Button size="sm" onClick={postRecurring}>
                  Post recurring due now
                </Button>
              </CardHeader>
              <CardContent>
                {data.recurringCharges.length === 0 ? (
                  <p className="text-sm text-fg-muted">None.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-fg-muted border-b border-border">
                      <tr>
                        <th className="py-1 text-left">Memo</th>
                        <th>Frequency</th>
                        <th>Next date</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recurringCharges.map((c) => (
                        <tr key={c.id} className="border-b border-border/40">
                          <td className="py-1">{c.memo || "—"}</td>
                          <td>{c.frequency}</td>
                          <td className="text-fg-muted">
                            {c.nextDate
                              ? new Date(c.nextDate).toLocaleDateString()
                              : "—"}
                          </td>
                          <td>
                            <CurrencyAmount cents={c.amount} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-xs text-fg-muted">
                  A nightly cron auto-posts charges as they come due. Use{" "}
                  <em>Post recurring due now</em> to post any due charges
                  immediately without waiting for the sweep.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>One-time charges</CardTitle>
              </CardHeader>
              <CardContent>
                {data.oneTimeCharges.length === 0 ? (
                  <p className="text-sm text-fg-muted">None.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.oneTimeCharges.map((c) => (
                      <li key={c.id}>
                        <CurrencyAmount cents={c.amount} />{" "}
                        {c.memo && `· ${c.memo}`}
                        {c.dueDate && (
                          <span className="text-fg-muted">
                            {" "}
                            · due {new Date(c.dueDate).toLocaleDateString()}
                          </span>
                        )}
                        {c.posted && (
                          <Badge variant="gain" className="ml-2">
                            Posted
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>eSignature documents</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {data.esignatureDocuments.length === 0 ? (
                  <p className="text-fg-muted">None.</p>
                ) : (
                  data.esignatureDocuments.map((d) => (
                    <div key={d.id} className="flex items-center gap-2">
                      <span>{d.label}</span>
                      <Badge variant="muted">{d.status}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tenant">
          <Card>
            <CardHeader>
              <CardTitle>Tenants & cosigners</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-fg-muted mb-1">Tenants</div>
                {data.tenants.length === 0 ? (
                  <p className="text-fg-muted">None.</p>
                ) : (
                  data.tenants.map((t) => (
                    <div key={t.tenantId}>
                      <Link
                        href={`/properties/rentals/tenants/${t.tenantId}`}
                        className="hover:underline"
                      >
                        {tenantDisplayName(t)}
                      </Link>
                      {t.email && (
                        <span className="text-fg-muted"> · {t.email}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
              {data.cosigners.length > 0 && (
                <div>
                  <div className="text-xs text-fg-muted mb-1">Cosigners</div>
                  {data.cosigners.map((t) => (
                    <div key={t.tenantId}>{tenantDisplayName(t)}</div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <CommunicationsTab
            relatedEntityType="Lease"
            relatedEntityId={data.id}
          />
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Event history</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityLog parentType="Lease" parentId={data.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EvictionToggleDialog
        open={evictionOpen}
        onClose={() => setEvictionOpen(false)}
        onSaved={load}
        leaseId={data.id}
        evictionPending={data.evictionPending}
        currentNote={data.evictionPendingNote}
      />
      <RentersInsuranceModal
        open={insuranceOpen}
        onClose={() => {
          setInsuranceOpen(false);
          setInsuranceEditingId(undefined);
        }}
        editingId={insuranceEditingId}
        onSaved={load}
        leaseId={data.id}
        leaseTenants={data.tenants.map((t) => ({
          tenantId: t.tenantId,
          firstName: t.firstName,
          lastName: t.lastName,
        }))}
      />
      <PetModal
        open={petOpen}
        onClose={() => {
          setPetOpen(false);
          setPetEditingId(undefined);
        }}
        editingId={petEditingId}
        onSaved={load}
        leaseId={data.id}
        leaseTenants={data.tenants.map((t) => ({
          tenantId: t.tenantId,
          firstName: t.firstName,
          lastName: t.lastName,
        }))}
      />
      <EditLeaseModal
        open={editLeaseOpen}
        onClose={() => setEditLeaseOpen(false)}
        leaseId={data.id}
        onSaved={load}
      />
    </div>
  );
}
