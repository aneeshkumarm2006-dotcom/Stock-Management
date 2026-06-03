// Renters insurance create modal for a lease. POSTs to
// /api/pm/leases/:id/renters-insurance. The server surfaces a `warning` when
// liability falls below the property minimum (BR-LL-6 spirit).
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
import {
  RENTERS_INSURANCE_CARRIERS,
  type RentersInsuranceCarrier,
} from "@/types/pm";

interface RentersInsuranceModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  leaseId: string;
  leaseTenants: Array<{ tenantId: string; firstName: string; lastName: string }>;
  /** When set, modal loads the policy and saves via PATCH. */
  editingId?: string;
}

export function RentersInsuranceModal({
  open,
  onClose,
  onSaved,
  leaseId,
  leaseTenants,
  editingId,
}: RentersInsuranceModalProps) {
  const { toast } = useToast();
  const isEdit = Boolean(editingId);
  const [carrier, setCarrier] =
    React.useState<RentersInsuranceCarrier>("Third Party");
  const [policyNumber, setPolicyNumber] = React.useState("");
  const [liability, setLiability] = React.useState("0");
  const [effectiveDate, setEffectiveDate] = React.useState("");
  const [expirationDate, setExpirationDate] = React.useState("");
  const [covered, setCovered] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (!editingId) {
      setCarrier("Third Party");
      setPolicyNumber("");
      setLiability("0");
      setEffectiveDate("");
      setExpirationDate("");
      setCovered(new Set());
      return;
    }
    let cancelled = false;
    fetch(`/api/pm/leases/${leaseId}/renters-insurance/${editingId}`).then(
      async (r) => {
        if (!r.ok || cancelled) return;
        const p = (await r.json()) as {
          carrier: RentersInsuranceCarrier;
          policyNumber: string;
          liabilityCoverage: number;
          effectiveDate: string;
          expirationDate: string;
          coveredResidents: string[];
        };
        if (cancelled) return;
        setCarrier(p.carrier);
        setPolicyNumber(p.policyNumber ?? "");
        setLiability(String((p.liabilityCoverage ?? 0) / 100));
        setEffectiveDate(
          p.effectiveDate ? p.effectiveDate.slice(0, 10) : "",
        );
        setExpirationDate(
          p.expirationDate ? p.expirationDate.slice(0, 10) : "",
        );
        setCovered(new Set(p.coveredResidents ?? []));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, editingId, leaseId]);

  async function save() {
    if (!effectiveDate || !expirationDate) {
      toast({ title: "Effective and expiration dates required", variant: "error" });
      return;
    }
    if (new Date(expirationDate) <= new Date(effectiveDate)) {
      toast({
        title: "expirationDate must be after effectiveDate",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    const payload = {
      carrier,
      policyNumber: policyNumber || undefined,
      liabilityCoverage: Number(liability) || 0,
      effectiveDate,
      expirationDate,
      coveredResidents: Array.from(covered),
    };
    const url = isEdit
      ? `/api/pm/leases/${leaseId}/renters-insurance/${editingId}`
      : `/api/pm/leases/${leaseId}/renters-insurance`;
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
    const data = (await res.json().catch(() => ({}))) as {
      warning?: string | null;
    };
    toast({
      title: data.warning
        ? "Policy saved (warning)"
        : isEdit
          ? "Policy updated"
          : "Policy saved",
      description: data.warning ?? undefined,
      variant: data.warning ? "error" : "success",
    });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={
            isEdit
              ? "Edit renters insurance policy"
              : "Add renters insurance policy"
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Carrier</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={carrier}
              onChange={(e) =>
                setCarrier(e.target.value as RentersInsuranceCarrier)
              }
            >
              {RENTERS_INSURANCE_CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Policy number</Label>
            <Input
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
            />
          </div>
          <div>
            <Label>Liability coverage ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={liability}
              onChange={(e) => setLiability(e.target.value)}
            />
          </div>
          <div>
            <Label>Effective date</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Expiration date</Label>
            <Input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
            />
          </div>
        </div>
        {leaseTenants.length > 0 && (
          <div>
            <Label>Covered residents</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Empty = all tenants on the lease are covered (default).
            </p>
            <div className="space-y-1">
              {leaseTenants.map((t) => (
                <label
                  key={t.tenantId}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={covered.has(t.tenantId)}
                    onChange={(e) =>
                      setCovered((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(t.tenantId);
                        else next.delete(t.tenantId);
                        return next;
                      })
                    }
                  />
                  {t.firstName} {t.lastName}
                </label>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
