// Prospect create/edit modal. Lightweight CRM record at the top of the
// funnel; just enough fields to capture an inbound lead.
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
import { PROSPECT_STATUSES, type ProspectStatus } from "@/types/pm";

interface PropertyOption {
  id: string;
  propertyName: string;
}

interface ProspectFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  existing?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    status: ProspectStatus;
    propertyId?: string | null;
    movingDate?: string | null;
    beds?: number | null;
    notes?: string;
  } | null;
}

export function ProspectFormModal({
  open,
  onClose,
  onSaved,
  existing,
}: ProspectFormModalProps) {
  const { toast } = useToast();
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [status, setStatus] = React.useState<ProspectStatus>("New");
  const [propertyId, setPropertyId] = React.useState("");
  const [movingDate, setMovingDate] = React.useState("");
  const [beds, setBeds] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (existing) {
      setFirstName(existing.firstName);
      setLastName(existing.lastName);
      setEmail(existing.email ?? "");
      setPhone(existing.phone ?? "");
      setStatus(existing.status);
      setPropertyId(existing.propertyId ?? "");
      setMovingDate(
        existing.movingDate
          ? new Date(existing.movingDate).toISOString().slice(0, 10)
          : "",
      );
      setBeds(existing.beds != null ? String(existing.beds) : "");
      setNotes(existing.notes ?? "");
    } else {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setStatus("New");
      setPropertyId("");
      setMovingDate("");
      setBeds("");
      setNotes("");
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

  async function save() {
    if (!firstName || !lastName) {
      toast({ title: "First and last name required", variant: "error" });
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      firstName,
      lastName,
      email: email || undefined,
      phone: phone || undefined,
      status,
      propertyId: propertyId || null,
      movingDate: movingDate || null,
      beds: beds ? Number(beds) : null,
      notes,
    };
    const res = await fetch(
      existing ? `/api/pm/prospects/${existing.id}` : "/api/pm/prospects",
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
    toast({ title: existing ? "Prospect updated" : "Prospect created" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader title={existing ? "Edit prospect" : "New prospect"} onClose={onClose} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>First name</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label>Last name</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>Status</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProspectStatus)}
            >
              {PROSPECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Property of interest</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              <option value="">— none —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.propertyName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Target move-in date</Label>
            <Input
              type="date"
              value={movingDate}
              onChange={(e) => setMovingDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Bedrooms wanted</Label>
            <Input
              type="number"
              min="0"
              max="10"
              value={beds}
              onChange={(e) => setBeds(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <textarea
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
