// Pet attach modal for a lease.
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
import { PET_TYPES, type PetType } from "@/types/pm";

interface PetModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  leaseId: string;
  leaseTenants: Array<{ tenantId: string; firstName: string; lastName: string }>;
  /** When set, modal loads the pet and saves via PATCH. */
  editingId?: string;
}

export function PetModal({
  open,
  onClose,
  onSaved,
  leaseId,
  leaseTenants,
  editingId,
}: PetModalProps) {
  const { toast } = useToast();
  const isEdit = Boolean(editingId);
  const [name, setName] = React.useState("");
  const [petType, setPetType] = React.useState<PetType>("Dog");
  const [breed, setBreed] = React.useState("");
  const [weightLbs, setWeightLbs] = React.useState("");
  const [ageYears, setAgeYears] = React.useState("");
  const [licenseNumber, setLicenseNumber] = React.useState("");
  const [ownerTenantId, setOwnerTenantId] = React.useState("");
  const [assistanceAnimal, setAssistanceAnimal] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (!editingId) {
      setName("");
      setPetType("Dog");
      setBreed("");
      setWeightLbs("");
      setAgeYears("");
      setLicenseNumber("");
      setOwnerTenantId("");
      setAssistanceAnimal(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/pm/leases/${leaseId}/pets/${editingId}`).then(async (r) => {
      if (!r.ok || cancelled) return;
      const p = (await r.json()) as {
        name: string;
        petType: PetType;
        breed: string;
        weightLbs: number | null;
        ageYears: number | null;
        licenseNumber: string;
        ownerTenantId: string | null;
        assistanceAnimal: boolean;
      };
      if (cancelled) return;
      setName(p.name);
      setPetType(p.petType);
      setBreed(p.breed ?? "");
      setWeightLbs(p.weightLbs != null ? String(p.weightLbs) : "");
      setAgeYears(p.ageYears != null ? String(p.ageYears) : "");
      setLicenseNumber(p.licenseNumber ?? "");
      setOwnerTenantId(p.ownerTenantId ?? "");
      setAssistanceAnimal(p.assistanceAnimal);
    });
    return () => {
      cancelled = true;
    };
  }, [open, editingId, leaseId]);

  async function save() {
    if (!name) {
      toast({ title: "Pet name required", variant: "error" });
      return;
    }
    setSaving(true);
    const payload = {
      name,
      petType,
      breed: breed || undefined,
      weightLbs: weightLbs ? Number(weightLbs) : undefined,
      ageYears: ageYears ? Number(ageYears) : undefined,
      licenseNumber: licenseNumber || undefined,
      ownerTenantId: ownerTenantId || null,
      assistanceAnimal,
    };
    const url = isEdit
      ? `/api/pm/leases/${leaseId}/pets/${editingId}`
      : `/api/pm/leases/${leaseId}/pets`;
    const method = isEdit ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Save failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    toast({ title: isEdit ? "Pet updated" : "Pet added" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader title={isEdit ? "Edit pet" : "Add pet"} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Type</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={petType}
              onChange={(e) => setPetType(e.target.value as PetType)}
            >
              {PET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Breed</Label>
            <Input value={breed} onChange={(e) => setBreed(e.target.value)} />
          </div>
          <div>
            <Label>Weight (lbs)</Label>
            <Input
              type="number"
              min="0"
              max="500"
              value={weightLbs}
              onChange={(e) => setWeightLbs(e.target.value)}
            />
          </div>
          <div>
            <Label>Age (years)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              value={ageYears}
              onChange={(e) => setAgeYears(e.target.value)}
            />
          </div>
          <div>
            <Label>License #</Label>
            <Input
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
            />
          </div>
          <div>
            <Label>Owner tenant</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={ownerTenantId}
              onChange={(e) => setOwnerTenantId(e.target.value)}
            >
              <option value="">— none —</option>
              {leaseTenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="esa"
              type="checkbox"
              checked={assistanceAnimal}
              onChange={(e) => setAssistanceAnimal(e.target.checked)}
            />
            <label htmlFor="esa" className="text-sm">
              Assistance / service animal
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add pet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
