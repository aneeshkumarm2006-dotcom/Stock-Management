// Applicant create modal. Captures the minimal application — checklist
// auto-seeds on save (BR-LA-5). For edits, the detail page surfaces inline
// editors instead of re-opening this modal.
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

interface ApplicantFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void | Promise<void>;
}

export function ApplicantFormModal({
  open,
  onClose,
  onSaved,
}: ApplicantFormModalProps) {
  const { toast } = useToast();
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [units, setUnits] = React.useState<UnitOption[]>([]);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [propertyId, setPropertyId] = React.useState("");
  const [unitId, setUnitId] = React.useState("");
  const [emailLink, setEmailLink] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setPropertyId("");
    setUnitId("");
    setEmailLink(false);
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
  }, [open]);

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
    if (!firstName || !lastName) {
      toast({ title: "First and last name required", variant: "error" });
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      firstName,
      lastName,
      email: email || undefined,
      phones: phone ? [{ number: phone, label: "mobile" }] : [],
      propertyId: propertyId || null,
      unitId: unitId || null,
      emailLinkToOnlineApplication: emailLink,
    };
    const res = await fetch("/api/pm/applicants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Create failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    const data = (await res.json()) as { id: string };
    toast({ title: "Applicant created" });
    onClose();
    await onSaved(data.id);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader title="New applicant" />
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
            <Label>Property</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setUnitId("");
              }}
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
              disabled={!propertyId}
            >
              <option value="">— select —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitId}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input
              id="emailLink"
              type="checkbox"
              checked={emailLink}
              onChange={(e) => setEmailLink(e.target.checked)}
            />
            <label htmlFor="emailLink" className="text-sm">
              Email applicant a link to the online application (BR-LA-4 — Phase
              6 will dispatch)
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
