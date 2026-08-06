"use client";

// One control for "which property or company does this belong to".
//
// Every scope UI in the module used to be a PAIR of selects — a narrow
// Property/Company toggle plus a property dropdown that sat disabled whenever
// Company was chosen. That shape cannot express *which* company, and in the
// recurring amounts grid the pair already overflowed a 224px cell.
//
// Merging them into one <select> with <optgroup>s removes a control instead of
// adding one, buys back the width company names need, and makes the invalid
// intermediate state (scopeType='Property' with an empty scopeId) unreachable.

import * as React from "react";

export interface ScopeOption {
  id: string;
  name: string;
}

export type ScopePickerValue = {
  scopeType: "Property" | "Company";
  /** "" means no selection — or, for Company, the legacy unnamed bucket. */
  scopeId: string;
};

export interface ScopePickerProps extends ScopePickerValue {
  onChange: (next: ScopePickerValue) => void;
  properties: ScopeOption[];
  companies: ScopeOption[];
  disabled?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  /**
   * Render a "Company (not specified)" entry for rows saved before companies
   * were nameable. It appears ONLY when the current value is already in that
   * state, so an existing rule never silently acquires a company it didn't
   * have, and the option cannot be chosen fresh.
   */
  allowUnnamedCompany?: boolean;
}

const PROPERTY_PREFIX = "property:";
const COMPANY_PREFIX = "company:";

export function encodeScopeValue(v: ScopePickerValue): string {
  if (v.scopeType === "Property") {
    return v.scopeId ? `${PROPERTY_PREFIX}${v.scopeId}` : "";
  }
  return `${COMPANY_PREFIX}${v.scopeId ?? ""}`;
}

export function decodeScopeValue(raw: string): ScopePickerValue {
  if (raw.startsWith(PROPERTY_PREFIX)) {
    return { scopeType: "Property", scopeId: raw.slice(PROPERTY_PREFIX.length) };
  }
  if (raw.startsWith(COMPANY_PREFIX)) {
    return { scopeType: "Company", scopeId: raw.slice(COMPANY_PREFIX.length) };
  }
  return { scopeType: "Property", scopeId: "" };
}

export function ScopePicker({
  scopeType,
  scopeId,
  onChange,
  properties,
  companies,
  disabled,
  id,
  className,
  placeholder = "Choose…",
  allowUnnamedCompany = true,
  ...rest
}: ScopePickerProps) {
  const isUnnamedCompany = scopeType === "Company" && !scopeId;
  const value = encodeScopeValue({ scopeType, scopeId });

  // A company that was archived after being picked would otherwise vanish from
  // the list and the select would silently jump to the first option.
  const knownCompany =
    !scopeId || companies.some((c) => c.id === scopeId) || scopeType !== "Company";
  const knownProperty =
    !scopeId ||
    properties.some((p) => p.id === scopeId) ||
    scopeType !== "Property";

  return (
    <select
      id={id}
      className={
        className ??
        "h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm disabled:opacity-60"
      }
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(decodeScopeValue(e.target.value))}
      aria-label={rest["aria-label"]}
    >
      <option value="">{placeholder}</option>

      {allowUnnamedCompany && isUnnamedCompany ? (
        <option value={COMPANY_PREFIX}>Company (not specified)</option>
      ) : null}

      {!knownCompany ? (
        <option value={`${COMPANY_PREFIX}${scopeId}`}>
          (archived company)
        </option>
      ) : null}
      {!knownProperty ? (
        <option value={`${PROPERTY_PREFIX}${scopeId}`}>
          (archived property)
        </option>
      ) : null}

      {companies.length > 0 ? (
        <optgroup label="Company">
          {companies.map((c) => (
            <option key={c.id} value={`${COMPANY_PREFIX}${c.id}`}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ) : null}

      {properties.length > 0 ? (
        <optgroup label="Property">
          {properties.map((p) => (
            <option key={p.id} value={`${PROPERTY_PREFIX}${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}

/**
 * Fetch the org's companies while a modal is open, clearing on close.
 *
 * The clear-on-close is not incidental: without it a stale catalog from the
 * previous open flashes before the refetch resolves (the ADD-012 bug fixed in
 * AddBudgetModal). Sharing the hook means every new scope picker inherits that
 * fix instead of rediscovering it.
 */
export function useCompanyAccounts(open: boolean): ScopeOption[] {
  const [companies, setCompanies] = React.useState<ScopeOption[]>([]);

  React.useEffect(() => {
    if (!open) {
      setCompanies([]);
      return;
    }
    let cancelled = false;
    fetch("/api/pm/company-accounts")
      .then(async (r) => {
        if (!r.ok || cancelled) return;
        const rows = (await r.json()) as Array<{
          id: string;
          name: string;
          active?: boolean;
        }>;
        if (cancelled) return;
        setCompanies(
          rows
            .filter((c) => c.active !== false)
            .map((c) => ({ id: c.id, name: c.name })),
        );
      })
      .catch(() => {
        /* leave the list empty — the picker still renders properties */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return companies;
}
