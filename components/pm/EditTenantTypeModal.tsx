// Change a tenant's type (Individual ⇄ Company) after creation (changes.md §1
// — client request: tenants first registered as Individuals need converting to
// Company). The Add flow already chooses a type at creation; this modal is the
// matching post-creation editor.
//
// Mirrors the AddTenantModal field layout and the house Edit*Modal conventions
// (EditVendorModal): a raw <select> discriminator with conditional fields,
// client validation that matches the Tenant model's pre('validate') rule, and a
// PATCH to /api/pm/tenants/:id. The route clears the off-type fields and
// propagates the change to every lease/draft-lease snapshot, so the caller only
// needs to refetch on success.
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
import type { TenantType } from "@/types/pm";

export interface EditTenantTypeCurrent {
  tenantType: TenantType;
  firstName: string;
  lastName: string;
  companyName: string;
  contactPersonName: string;
}

interface Props {
  open: boolean;
  tenantId: string;
  current: EditTenantTypeCurrent;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function EditTenantTypeModal({
  open,
  tenantId,
  current,
  onClose,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [tenantType, setTenantType] = React.useState<TenantType>(
    current.tenantType,
  );
  const [firstName, setFirstName] = React.useState(current.firstName);
  const [lastName, setLastName] = React.useState(current.lastName);
  const [companyName, setCompanyName] = React.useState(current.companyName);
  const [contactPersonName, setContactPersonName] = React.useState(
    current.contactPersonName,
  );
  const [saving, setSaving] = React.useState(false);

  // Re-seed the form from the live record every time the dialog opens so a
  // reopened modal never shows a stale draft from a previous edit.
  React.useEffect(() => {
    if (!open) return;
    setTenantType(current.tenantType);
    setFirstName(current.firstName);
    setLastName(current.lastName);
    setCompanyName(current.companyName);
    setContactPersonName(current.contactPersonName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isCompany = tenantType === "Company";
  const changingTo = tenantType !== current.tenantType;

  function onTypeChange(next: TenantType) {
    setTenantType(next);
    // Convenience for the common case (a company mis-registered as an
    // Individual): when switching to Company with no company name yet, seed it
    // from the existing personal name so the user usually just confirms.
    if (next === "Company" && !companyName.trim()) {
      const seeded = `${current.firstName} ${current.lastName}`.trim();
      if (seeded) setCompanyName(seeded);
    }
  }

  async function save() {
    // Mirror the Tenant model's conditional-required rule client-side.
    if (isCompany) {
      if (!companyName.trim()) {
        toast({ title: "Company name is required", variant: "error" });
        return;
      }
    } else if (!firstName.trim() || !lastName.trim()) {
      toast({ title: "First and last name are required", variant: "error" });
      return;
    }

    // Send only the target type's fields; the route clears the off-type fields.
    const payload = isCompany
      ? {
          tenantType: "Company" as const,
          companyName: companyName.trim(),
          contactPersonName: contactPersonName.trim() || undefined,
        }
      : {
          tenantType: "Individual" as const,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        };

    setSaving(true);
    const res = await fetch(`/api/pm/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Save failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Tenant type updated", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title="Edit tenant type"
          description="Convert this tenant between Individual and Company."
          onClose={onClose}
        />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ett-type">Tenant type</Label>
            <select
              id="ett-type"
              className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
              value={tenantType}
              onChange={(e) => onTypeChange(e.target.value as TenantType)}
            >
              <option value="Individual">Individual</option>
              <option value="Company">Company</option>
            </select>
          </div>

          {isCompany ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="ett-company">Company name *</Label>
                <Input
                  id="ett-company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Holdings Inc."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ett-contact">Contact person</Label>
                <Input
                  id="ett-contact"
                  value={contactPersonName}
                  onChange={(e) => setContactPersonName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </div>
            </>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ett-first">First name *</Label>
                <Input
                  id="ett-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ett-last">Last name *</Label>
                <Input
                  id="ett-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
          )}

          {changingTo && (
            <p className="rounded border border-border bg-surface px-3 py-2 text-xs text-fg-muted">
              {isCompany
                ? "Switching to Company. The personal name will be cleared; the company name shows everywhere this tenant appears, including existing leases."
                : "Switching to Individual. The company name will be cleared; the personal name shows everywhere this tenant appears, including existing leases."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EditTenantTypeModal;
