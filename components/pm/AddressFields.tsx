"use client";

// Composite address input shared by Property, RentalOwner, Tenant, Vendor.
// Mirrors PDR §3.1 / §3.6 fields (line1..line3, city, state, zip, country
// defaults to `US`). Country selector switches the subdivision dropdown
// between US states/territories and Canadian provinces/territories, and
// also swaps the ZIP/Postal-code label + pattern.
import * as React from "react";
import type { StateOrProvince, AddressCountry } from "@/types/pm";
import {
  US_STATES,
  CA_PROVINCES,
  CA_PROVINCE_NAMES,
} from "@/types/pm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AddressValue {
  line1: string;
  line2?: string;
  line3?: string;
  city: string;
  state: StateOrProvince | "";
  zip: string;
  country: AddressCountry | string;
}

export const emptyAddress: AddressValue = {
  line1: "",
  line2: "",
  line3: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
};

interface Props {
  prefix: string;
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  required?: boolean;
}

// US ZIP: 5 digits or 5+4.
// CA postal code: A1A 1A1 (space optional), letters case-insensitive,
// excludes D, F, I, O, Q, U from first letter and W, Z from any letter
// per Canada Post — we keep a lenient pattern so users aren't blocked.
const US_ZIP_PATTERN = "\\d{5}(-\\d{4})?";
const CA_POSTAL_PATTERN = "[A-Za-z]\\d[A-Za-z][ -]?\\d[A-Za-z]\\d";

export function AddressFields({ prefix, value, onChange, required }: Props) {
  const set = <K extends keyof AddressValue>(key: K, v: AddressValue[K]) =>
    onChange({ ...value, [key]: v });

  // Treat unknown/legacy country strings as US so existing data keeps rendering
  // the US dropdown. Switching to CA via the selector also clears any
  // previously-selected US state code that isn't valid in Canada.
  const country: AddressCountry = value.country === "CA" ? "CA" : "US";
  const isCanada = country === "CA";

  function onCountryChange(next: AddressCountry) {
    const stateValid =
      next === "US"
        ? (US_STATES as readonly string[]).includes(value.state)
        : (CA_PROVINCES as readonly string[]).includes(value.state);
    onChange({
      ...value,
      country: next,
      state: stateValid ? value.state : "",
    });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor={`${prefix}-line1`}>
          Address line 1{required && <span className="text-error"> *</span>}
        </Label>
        <Input
          id={`${prefix}-line1`}
          value={value.line1}
          onChange={(e) => set("line1", e.target.value)}
          required={required}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-line2`}>Address line 2</Label>
        <Input
          id={`${prefix}-line2`}
          value={value.line2 ?? ""}
          onChange={(e) => set("line2", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-line3`}>Address line 3</Label>
        <Input
          id={`${prefix}-line3`}
          value={value.line3 ?? ""}
          onChange={(e) => set("line3", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-country`}>Country</Label>
        <select
          id={`${prefix}-country`}
          value={country}
          onChange={(e) => onCountryChange(e.target.value as AddressCountry)}
          className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
        >
          <option value="US">United States</option>
          <option value="CA">Canada</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-city`}>
          City{required && <span className="text-error"> *</span>}
        </Label>
        <Input
          id={`${prefix}-city`}
          value={value.city}
          onChange={(e) => set("city", e.target.value)}
          required={required}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-state`}>
          {isCanada ? "Province" : "State"}
          {required && <span className="text-error"> *</span>}
        </Label>
        <select
          id={`${prefix}-state`}
          value={value.state}
          onChange={(e) =>
            set("state", e.target.value as StateOrProvince | "")
          }
          required={required}
          className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
        >
          <option value="">—</option>
          {isCanada
            ? CA_PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p} — {CA_PROVINCE_NAMES[p]}
                </option>
              ))
            : US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-zip`}>
          {isCanada ? "Postal code" : "ZIP"}
          {required && <span className="text-error"> *</span>}
        </Label>
        <Input
          id={`${prefix}-zip`}
          value={value.zip}
          onChange={(e) => set("zip", e.target.value)}
          pattern={isCanada ? CA_POSTAL_PATTERN : US_ZIP_PATTERN}
          placeholder={isCanada ? "A1A 1A1" : "12345"}
          required={required}
        />
      </div>
    </div>
  );
}

export default AddressFields;
