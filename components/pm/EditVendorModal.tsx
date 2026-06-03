// Full-surface vendor edit modal. The list page's AddVendorModal captures the
// minimum (name + email) at creation; this modal covers everything the detail
// page can show — contact, phones, address, insurance, 1099 — and PATCHes
// /api/pm/vendors/:id. See vendorUpdateSchema for the validated surface.
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
import type { TaxIdentityType } from "@/types/pm";

interface Address {
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface PhoneInput {
  number: string;
  smsOptIn?: boolean;
}

interface VendorForm {
  firstName: string;
  lastName: string;
  isCompany: boolean;
  companyName: string;
  accountNumber: string;
  primaryEmail: string;
  alternateEmail: string;
  website: string;
  comments: string;
  phones: {
    mobile: PhoneInput;
    home: PhoneInput;
    work: PhoneInput;
    fax: PhoneInput;
  };
  address: Address;
  taxIdentityType: TaxIdentityType | "";
  taxpayerIdLast4: string;
  insurance: {
    provider: string;
    policyNumber: string;
    expirationDate: string;
  };
}

const PHONE_KEYS = ["mobile", "home", "work", "fax"] as const;

const emptyForm: VendorForm = {
  firstName: "",
  lastName: "",
  isCompany: false,
  companyName: "",
  accountNumber: "",
  primaryEmail: "",
  alternateEmail: "",
  website: "",
  comments: "",
  phones: {
    mobile: { number: "" },
    home: { number: "" },
    work: { number: "" },
    fax: { number: "" },
  },
  address: {},
  taxIdentityType: "",
  taxpayerIdLast4: "",
  insurance: { provider: "", policyNumber: "", expirationDate: "" },
};

interface Props {
  open: boolean;
  vendorId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function EditVendorModal({ open, vendorId, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<VendorForm>(emptyForm);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !vendorId) {
      setForm(emptyForm);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/pm/vendors/${vendorId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Load failed (${r.status})`);
        return (await r.json()) as {
          firstName: string;
          lastName: string;
          isCompany: boolean;
          companyName: string;
          accountNumber: string;
          primaryEmail: string;
          alternateEmail: string;
          website: string;
          comments: string;
          phones: Partial<
            Record<(typeof PHONE_KEYS)[number], { number?: string; smsOptIn?: boolean }>
          >;
          address: Address;
          taxIdentityType: TaxIdentityType | null;
          taxpayerIdLast4: string;
          insurance: {
            provider?: string;
            policyNumber?: string;
            expirationDate?: string | null;
          };
        };
      })
      .then((v) => {
        if (cancelled) return;
        setForm({
          firstName: v.firstName ?? "",
          lastName: v.lastName ?? "",
          isCompany: v.isCompany ?? false,
          companyName: v.companyName ?? "",
          accountNumber: v.accountNumber ?? "",
          primaryEmail: v.primaryEmail ?? "",
          alternateEmail: v.alternateEmail ?? "",
          website: v.website ?? "",
          comments: v.comments ?? "",
          phones: {
            mobile: {
              number: v.phones?.mobile?.number ?? "",
              smsOptIn: v.phones?.mobile?.smsOptIn,
            },
            home: {
              number: v.phones?.home?.number ?? "",
              smsOptIn: v.phones?.home?.smsOptIn,
            },
            work: {
              number: v.phones?.work?.number ?? "",
              smsOptIn: v.phones?.work?.smsOptIn,
            },
            fax: {
              number: v.phones?.fax?.number ?? "",
              smsOptIn: v.phones?.fax?.smsOptIn,
            },
          },
          address: v.address ?? {},
          taxIdentityType: v.taxIdentityType ?? "",
          taxpayerIdLast4: v.taxpayerIdLast4 ?? "",
          insurance: {
            provider: v.insurance?.provider ?? "",
            policyNumber: v.insurance?.policyNumber ?? "",
            expirationDate: v.insurance?.expirationDate
              ? v.insurance.expirationDate.slice(0, 10)
              : "",
          },
        });
      })
      .catch((e: Error) => {
        if (!cancelled) {
          toast({ title: "Could not load vendor", description: e.message, variant: "error" });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, vendorId, toast]);

  async function save() {
    if (!vendorId) return;
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name required", variant: "error" });
      return;
    }
    // EDIT-016: when flagged as a company, a non-empty company name is required;
    // when not, the stored company name must be cleared so a stale value can't
    // linger on the record.
    if (form.isCompany && !form.companyName.trim()) {
      toast({ title: "Company name is required", variant: "error" });
      return;
    }
    setSaving(true);
    const phones: Record<string, PhoneInput> = {};
    for (const k of PHONE_KEYS) {
      const n = form.phones[k].number.trim();
      // Round-trip smsOptIn for every label so a save doesn't silently reset
      // the opt-in flags the API returned (EDIT-015).
      if (n) phones[k] = { number: n, smsOptIn: form.phones[k].smsOptIn };
    }
    const insurance = {
      provider: form.insurance.provider.trim() || undefined,
      policyNumber: form.insurance.policyNumber.trim() || undefined,
      // EDIT-017: send a bare YYYY-MM-DD instead of a UTC ISO timestamp so the
      // date doesn't shift a day in negative-offset timezones.
      expirationDate: form.insurance.expirationDate
        ? form.insurance.expirationDate
        : null,
    };
    const payload: Record<string, unknown> = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      isCompany: form.isCompany,
      // EDIT-016: explicit null clears the persisted name when not a company.
      companyName: form.isCompany ? form.companyName.trim() : null,
      accountNumber: form.accountNumber.trim() || undefined,
      primaryEmail: form.primaryEmail.trim() || undefined,
      alternateEmail: form.alternateEmail.trim() || undefined,
      website: form.website.trim() || undefined,
      comments: form.comments.trim() || undefined,
      phones,
      address: form.address,
      insurance,
      taxIdentityType: form.taxIdentityType || null,
      taxpayerIdLast4: form.taxpayerIdLast4.trim() || undefined,
    };
    const res = await fetch(`/api/pm/vendors/${vendorId}`, {
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
    toast({ title: "Vendor updated", variant: "success" });
    onClose();
    await onSaved();
  }

  function setAddress(patch: Partial<Address>) {
    setForm((f) => ({ ...f, address: { ...f.address, ...patch } }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader title="Edit vendor" onClose={onClose} />
        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <div className="space-y-4">
            <section className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-widest text-fg-muted">
                Identity
              </h4>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isCompany}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      isCompany: e.target.checked,
                      // Clear the company name the moment the flag turns off so
                      // the field can't keep a stale value (EDIT-016).
                      companyName: e.target.checked ? form.companyName : "",
                    })
                  }
                />
                This is a company
              </label>
              {form.isCompany && (
                <div className="space-y-1">
                  <Label htmlFor="ev-company">Company name *</Label>
                  <Input
                    id="ev-company"
                    value={form.companyName}
                    onChange={(e) =>
                      setForm({ ...form, companyName: e.target.value })
                    }
                  />
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ev-first">First name *</Label>
                  <Input
                    id="ev-first"
                    value={form.firstName}
                    onChange={(e) =>
                      setForm({ ...form, firstName: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ev-last">Last name *</Label>
                  <Input
                    id="ev-last"
                    value={form.lastName}
                    onChange={(e) =>
                      setForm({ ...form, lastName: e.target.value })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-widest text-fg-muted">
                Contact
              </h4>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ev-email">Primary email</Label>
                  <Input
                    id="ev-email"
                    type="email"
                    value={form.primaryEmail}
                    onChange={(e) =>
                      setForm({ ...form, primaryEmail: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ev-email2">Alternate email</Label>
                  <Input
                    id="ev-email2"
                    type="email"
                    value={form.alternateEmail}
                    onChange={(e) =>
                      setForm({ ...form, alternateEmail: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ev-web">Website</Label>
                  <Input
                    id="ev-web"
                    value={form.website}
                    onChange={(e) =>
                      setForm({ ...form, website: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ev-acct">Account number with vendor</Label>
                  <Input
                    id="ev-acct"
                    value={form.accountNumber}
                    onChange={(e) =>
                      setForm({ ...form, accountNumber: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {PHONE_KEYS.map((k) => (
                  <div className="space-y-1" key={k}>
                    <Label htmlFor={`ev-ph-${k}`} className="capitalize">
                      {k}
                    </Label>
                    <Input
                      id={`ev-ph-${k}`}
                      value={form.phones[k].number}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          phones: {
                            ...form.phones,
                            [k]: {
                              ...form.phones[k],
                              number: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-widest text-fg-muted">
                Address
              </h4>
              <div className="space-y-2">
                <Input
                  placeholder="Line 1"
                  value={form.address.line1 ?? ""}
                  onChange={(e) => setAddress({ line1: e.target.value })}
                />
                <Input
                  placeholder="Line 2"
                  value={form.address.line2 ?? ""}
                  onChange={(e) => setAddress({ line2: e.target.value })}
                />
                <div className="grid gap-2 md:grid-cols-4">
                  <Input
                    placeholder="City"
                    value={form.address.city ?? ""}
                    onChange={(e) => setAddress({ city: e.target.value })}
                  />
                  <Input
                    placeholder="State"
                    maxLength={2}
                    value={form.address.state ?? ""}
                    onChange={(e) =>
                      setAddress({ state: e.target.value.toUpperCase() })
                    }
                  />
                  <Input
                    placeholder="ZIP"
                    value={form.address.zip ?? ""}
                    onChange={(e) => setAddress({ zip: e.target.value })}
                  />
                  <Input
                    placeholder="Country"
                    maxLength={2}
                    value={form.address.country ?? ""}
                    onChange={(e) =>
                      setAddress({ country: e.target.value.toUpperCase() })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-widest text-fg-muted">
                Insurance
              </h4>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="ev-ins-prov">Provider</Label>
                  <Input
                    id="ev-ins-prov"
                    value={form.insurance.provider}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        insurance: {
                          ...form.insurance,
                          provider: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ev-ins-num">Policy number</Label>
                  <Input
                    id="ev-ins-num"
                    value={form.insurance.policyNumber}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        insurance: {
                          ...form.insurance,
                          policyNumber: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ev-ins-exp">Expires</Label>
                  <Input
                    id="ev-ins-exp"
                    type="date"
                    value={form.insurance.expirationDate}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        insurance: {
                          ...form.insurance,
                          expirationDate: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-widest text-fg-muted">
                1099 / tax
              </h4>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ev-tax-type">Tax identity type</Label>
                  <select
                    id="ev-tax-type"
                    className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                    value={form.taxIdentityType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        taxIdentityType: e.target.value as
                          | TaxIdentityType
                          | "",
                      })
                    }
                  >
                    <option value="">—</option>
                    <option value="SSN">SSN</option>
                    <option value="EIN">EIN</option>
                    <option value="ITIN">ITIN</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ev-tax-last4">Taxpayer ID last 4</Label>
                  <Input
                    id="ev-tax-last4"
                    maxLength={4}
                    inputMode="numeric"
                    value={form.taxpayerIdLast4}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        taxpayerIdLast4: e.target.value.replace(/\D/g, ""),
                      })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <Label htmlFor="ev-comments">Comments</Label>
              <textarea
                id="ev-comments"
                rows={3}
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={form.comments}
                onChange={(e) =>
                  setForm({ ...form, comments: e.target.value })
                }
              />
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
