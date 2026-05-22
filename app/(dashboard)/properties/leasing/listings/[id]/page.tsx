// /properties/leasing/listings/[id] — Listing detail.
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ActivityLog } from "@/components/pm/ActivityLog";
import { NotesPanel } from "@/components/pm/NotesPanel";
import { FilesPanel } from "@/components/pm/FilesPanel";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { ListingFormModal } from "@/components/pm/ListingFormModal";

interface ListingDetail {
  id: string;
  unitId: string;
  propertyId: string;
  listed: boolean;
  listedDate: string | null;
  daysListed: number | null;
  availableDate: string | null;
  listingRent: number;
  listingDeposit: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  unitAmenities: string[];
  unitDescription: string;
  unitImages: string[];
  leaseTermsBlurb: string;
  property: {
    propertyName: string;
    address: Record<string, string>;
    amenities: string[];
    includedInRent: string[];
    listingDescription: string;
  } | null;
}

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const [data, setData] = React.useState<ListingDetail | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/listings/${params.id}`);
    if (r.status === 404) {
      notFound();
      return;
    }
    if (r.ok) setData((await r.json()) as ListingDetail);
    setLoading(false);
  }, [params.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) return <div className="p-4 text-fg-muted">Loading…</div>;

  async function toggle() {
    const res = await fetch(`/api/pm/listings/${data!.id}/list-toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listed: !data!.listed }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: data!.listed ? "Delist failed" : "List failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/properties/leasing/listings">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Listings
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">
          {data.property?.propertyName ?? "Listing"} · Unit
        </h1>
        <Badge variant={data.listed ? "gain" : "muted"}>
          {data.listed ? "Listed" : "Unlisted"}
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button size="sm" onClick={toggle}>
            {data.listed ? "Delist" : "List"}
          </Button>
          {data.listed && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const res = await fetch(
                    `/api/pm/listings/${data.id}/post-to-craigslist`,
                    { method: "POST" },
                  );
                  if (res.ok) toast({ title: "Posted (Phase 6 stub)" });
                  else toast({ title: "Post failed", variant: "error" });
                }}
              >
                <Megaphone className="h-3.5 w-3.5" /> Craigslist
              </Button>
              <a
                href={`/api/pm/listings/${data.id}/export-html`}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="outline" size="sm">
                  <ExternalLink className="h-3.5 w-3.5" /> HTML
                </Button>
              </a>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-fg-muted">Listing rent</div>
                  <div className="text-lg font-medium">
                    <CurrencyAmount cents={data.listingRent} /> / month
                  </div>
                </div>
                <div>
                  <div className="text-xs text-fg-muted">Deposit</div>
                  <div className="text-lg font-medium">
                    <CurrencyAmount cents={data.listingDeposit} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-fg-muted">Available</div>
                  <div>
                    {data.availableDate
                      ? new Date(data.availableDate).toLocaleDateString()
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-fg-muted">Contact</div>
                  <div>
                    {data.contactName || data.contactEmail || data.contactPhone || "—"}
                  </div>
                </div>
              </div>
              {data.unitDescription && (
                <div>
                  <div className="text-xs text-fg-muted">Description</div>
                  <p className="whitespace-pre-line">{data.unitDescription}</p>
                </div>
              )}
              {data.unitAmenities.length > 0 && (
                <div>
                  <div className="text-xs text-fg-muted">Amenities</div>
                  <div className="flex flex-wrap gap-1">
                    {data.unitAmenities.map((a) => (
                      <Badge key={a} variant="outline">
                        {a}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {data.leaseTermsBlurb && (
                <div>
                  <div className="text-xs text-fg-muted">Lease terms</div>
                  <p>{data.leaseTermsBlurb}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <NotesPanel parentType="Listing" parentId={data.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
            </CardHeader>
            <CardContent>
              <FilesPanel locationType="Listing" locationId={data.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Event history</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityLog parentType="Listing" parentId={data.id} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sidebar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-fg-muted">Listed date</div>
                <div>
                  {data.listedDate
                    ? new Date(data.listedDate).toLocaleDateString()
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Days listed</div>
                <div>{data.daysListed != null ? `${data.daysListed}d` : "—"}</div>
              </div>
              {data.property && (
                <div>
                  <div className="text-xs text-fg-muted">Property</div>
                  <Link
                    href={`/properties/rentals/properties/${data.propertyId}`}
                    className="hover:underline"
                  >
                    {data.property.propertyName}
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ListingFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
        existing={{
          id: data.id,
          unitId: data.unitId,
          propertyId: data.propertyId,
          availableDate: data.availableDate,
          listingRent: data.listingRent,
          listingDeposit: data.listingDeposit,
          contactName: data.contactName,
          contactPhone: data.contactPhone,
          contactEmail: data.contactEmail,
          unitDescription: data.unitDescription,
          leaseTermsBlurb: data.leaseTermsBlurb,
        }}
      />
    </div>
  );
}
