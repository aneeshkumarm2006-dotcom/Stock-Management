// Listing create/edit modal. POSTs to /api/pm/listings or PATCHes the
// existing row. Unit picker is property-scoped so PMs don't accidentally
// list a unit on the wrong building.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

interface PropertyOption {
  id: string;
  propertyName: string;
}
interface UnitOption {
  id: string;
  unitId: string;
}

interface ListingFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  existing?: {
    id: string;
    unitId: string;
    propertyId: string;
    availableDate?: string | null;
    listingRent: number;
    listingDeposit: number;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    unitDescription?: string;
    leaseTermsBlurb?: string;
  } | null;
}

export function ListingFormModal({
  open,
  onClose,
  onSaved,
  existing,
}: ListingFormModalProps) {
  const { toast } = useToast();
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [units, setUnits] = React.useState<UnitOption[]>([]);
  const [propertyId, setPropertyId] = React.useState("");
  const [unitId, setUnitId] = React.useState("");
  const [availableDate, setAvailableDate] = React.useState("");
  const [listingRent, setListingRent] = React.useState("0");
  const [listingDeposit, setListingDeposit] = React.useState("0");
  const [contactName, setContactName] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [unitDescription, setUnitDescription] = React.useState("");
  const [leaseTermsBlurb, setLeaseTermsBlurb] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (existing) {
      setPropertyId(existing.propertyId);
      setUnitId(existing.unitId);
      setAvailableDate(
        existing.availableDate
          ? new Date(existing.availableDate).toISOString().slice(0, 10)
          : "",
      );
      setListingRent((existing.listingRent / 100).toFixed(2));
      setListingDeposit((existing.listingDeposit / 100).toFixed(2));
      setContactName(existing.contactName ?? "");
      setContactPhone(existing.contactPhone ?? "");
      setContactEmail(existing.contactEmail ?? "");
      setUnitDescription(existing.unitDescription ?? "");
      setLeaseTermsBlurb(existing.leaseTermsBlurb ?? "");
    } else {
      setPropertyId("");
      setUnitId("");
      setAvailableDate("");
      setListingRent("0");
      setListingDeposit("0");
      setContactName("");
      setContactPhone("");
      setContactEmail("");
      setUnitDescription("");
      setLeaseTermsBlurb("");
    }
    let cancelled = false;
    fetch("/api/pm/properties")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setProperties(
          (data as { id: string; propertyName: string }[]).map((r) => ({
            id: r.id,
            propertyName: r.propertyName,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, existing]);

  React.useEffect(() => {
    if (!propertyId) {
      setUnits([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/pm/units?propertyId=${propertyId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setUnits(
          (data as { id: string; unitId: string }[]).map((r) => ({
            id: r.id,
            unitId: r.unitId,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  async function save() {
    if (!unitId) {
      toast({ title: "Pick a unit", variant: "error" });
      return;
    }
    setSaving(true);
    const payload = {
      unitId,
      availableDate: availableDate || null,
      listingRent: Number(listingRent) || 0,
      listingDeposit: Number(listingDeposit) || 0,
      contactName,
      contactPhone,
      contactEmail,
      unitDescription,
      leaseTermsBlurb,
    };
    const res = await fetch(
      existing ? `/api/pm/listings/${existing.id}` : "/api/pm/listings",
      {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: existing ? "Update failed" : "Create failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    toast({ title: existing ? "Listing updated" : "Listing created" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title={existing ? "Edit listing" : "New listing"} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Property</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setUnitId("");
              }}
              disabled={!!existing}
            >
              <option value="">— select —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.propertyName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Unit</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={!propertyId || !!existing}
            >
              <option value="">— select —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitId}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Available date</Label>
            <Input
              type="date"
              value={availableDate}
              onChange={(e) => setAvailableDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Listing rent ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={listingRent}
              onChange={(e) => setListingRent(e.target.value)}
            />
          </div>
          <div>
            <Label>Listing deposit ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={listingDeposit}
              onChange={(e) => setListingDeposit(e.target.value)}
            />
          </div>
          <div>
            <Label>Contact name</Label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
          <div>
            <Label>Contact phone</Label>
            <Input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <div>
            <Label>Contact email</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label>Unit description</Label>
            <textarea
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              rows={3}
              value={unitDescription}
              onChange={(e) => setUnitDescription(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label>Lease terms blurb</Label>
            <textarea
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              rows={2}
              value={leaseTermsBlurb}
              onChange={(e) => setLeaseTermsBlurb(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
