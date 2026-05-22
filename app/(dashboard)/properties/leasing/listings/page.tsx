// /properties/leasing/listings — two-tab list (Listed / Unlisted) with
// counter chips (BR-CX-2 match-counter respects filters). Row actions: List
// / Delist, Post to Craigslist, Export to HTML. BR-LA-1 occupancy check
// fires in the API; the UI surfaces the 409 message in a toast.
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, ExternalLink, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ListingFormModal } from "@/components/pm/ListingFormModal";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";

interface ListingRow {
  id: string;
  unitId: string;
  propertyId: string;
  propertyName: string;
  address: {
    line1?: string;
    city?: string;
    state?: string;
  } | null;
  listed: boolean;
  listedDate: string | null;
  daysListed: number | null;
  availableDate: string | null;
  listingRent: number;
  listingDeposit: number;
}

export default function ListingsPage() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<ListingRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<"listed" | "unlisted">("listed");
  const [modalOpen, setModalOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    const r = await fetch(`/api/pm/listings?${params.toString()}`);
    if (r.ok) setRows((await r.json()) as ListingRow[]);
    setLoading(false);
  }, [search]);

  React.useEffect(() => {
    load();
  }, [load]);

  const listedRows = React.useMemo(
    () => rows.filter((r) => r.listed),
    [rows],
  );
  const unlistedRows = React.useMemo(
    () => rows.filter((r) => !r.listed),
    [rows],
  );
  const visible = filter === "listed" ? listedRows : unlistedRows;

  async function toggleListed(row: ListingRow) {
    const res = await fetch(`/api/pm/listings/${row.id}/list-toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listed: !row.listed }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: row.listed ? "Delist failed" : "List failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    toast({ title: row.listed ? "Delisted" : "Listed" });
    await load();
  }

  async function postToCraigslist(row: ListingRow) {
    const res = await fetch(
      `/api/pm/listings/${row.id}/post-to-craigslist`,
      { method: "POST" },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Post failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    toast({ title: "Posted (Phase 6 stub)" });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Listings</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add listing
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              label="Listed"
              count={listedRows.length}
              selected={filter === "listed"}
              onClick={() => setFilter("listed")}
            />
            <Chip
              label="Unlisted"
              count={unlistedRows.length}
              selected={filter === "unlisted"}
              onClick={() => setFilter("unlisted")}
            />
            <div className="ml-auto w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search listings"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Property / Unit</th>
                <th>Address</th>
                <th>Rent</th>
                <th>Available</th>
                <th>Days listed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-fg-muted">
                    No listings match.
                  </td>
                </tr>
              )}
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-border/40">
                  <td className="py-2">
                    <Link
                      href={`/properties/leasing/listings/${row.id}`}
                      className="font-medium hover:underline"
                    >
                      {row.propertyName}
                    </Link>
                  </td>
                  <td className="text-fg-muted">
                    {row.address?.line1
                      ? `${row.address.line1}, ${row.address.city ?? ""} ${row.address.state ?? ""}`
                      : "—"}
                  </td>
                  <td>
                    <CurrencyAmount cents={row.listingRent} />
                  </td>
                  <td className="text-fg-muted">
                    {row.availableDate
                      ? new Date(row.availableDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="text-fg-muted">
                    {row.daysListed != null ? `${row.daysListed}d` : "—"}
                  </td>
                  <td className="space-x-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleListed(row)}
                    >
                      {row.listed ? "Delist" : "List"}
                    </Button>
                    {row.listed && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => postToCraigslist(row)}
                          title="Post to Craigslist (BR-LA-2 — Phase 6 stub)"
                        >
                          <Megaphone className="h-3.5 w-3.5" />
                        </Button>
                        <a
                          href={`/api/pm/listings/${row.id}/export-html`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button size="sm" variant="outline">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-fg-muted">
            Match count: {visible.length} of {rows.length} loaded.
          </p>
        </CardContent>
      </Card>

      <ListingFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

function Chip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors " +
        (selected
          ? "border-primary bg-primary text-primary-fg"
          : "border-border bg-surface text-fg-muted hover:text-fg")
      }
    >
      {label}
      <Badge variant={selected ? "default" : "muted"}>{count}</Badge>
    </button>
  );
}
