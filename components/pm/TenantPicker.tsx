// Existing-tenant selector. Fetches active tenants once and exposes a native
// <select>. Returns the full option on change so callers can build a lease
// tenant ref (firstName/lastName/email) without a second fetch. Flags tenants
// already on a lease so the user doesn't accidentally double-assign.
"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";

export interface TenantOption {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  currentLeaseId: string | null;
}

interface TenantPickerProps {
  value: string;
  onChange: (tenant: TenantOption | null) => void;
  label?: string;
}

export function TenantPicker({
  value,
  onChange,
  label = "Tenant",
}: TenantPickerProps) {
  const [tenants, setTenants] = React.useState<TenantOption[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/pm/tenants")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TenantOption[]) => {
        if (!cancelled) setTenants(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <Label>{label}</Label>
      <select
        className="w-full rounded border bg-background px-2 py-1.5 text-sm"
        value={value}
        onChange={(e) =>
          onChange(tenants.find((t) => t.id === e.target.value) ?? null)
        }
        disabled={loading}
      >
        <option value="">
          {loading
            ? "Loading…"
            : tenants.length === 0
              ? "— no tenants — create one first"
              : "— select —"}
        </option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.displayName}
            {t.email ? ` — ${t.email}` : ""}
            {t.currentLeaseId ? " (already assigned)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export default TenantPicker;
