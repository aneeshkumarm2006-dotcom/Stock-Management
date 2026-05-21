"use client";

// Composite address input shared by Property, RentalOwner, Tenant, Vendor.
// Mirrors PDR §3.1 / §3.6 fields (line1..line3, city, state, zip, country
// defaults to `US`).
import * as React from "react";
import type { UsState } from "@/types/pm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AddressValue {
  line1: string;
  line2?: string;
  line3?: string;
  city: string;
  state: UsState | "";
  zip: string;
  country: string;
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

const US_STATES: UsState[] = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR",
];

interface Props {
  prefix: string;
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  required?: boolean;
}

export function AddressFields({ prefix, value, onChange, required }: Props) {
  const set = <K extends keyof AddressValue>(key: K, v: AddressValue[K]) =>
    onChange({ ...value, [key]: v });

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
          State{required && <span className="text-error"> *</span>}
        </Label>
        <select
          id={`${prefix}-state`}
          value={value.state}
          onChange={(e) => set("state", e.target.value as UsState | "")}
          required={required}
          className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
        >
          <option value="">—</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-zip`}>
          ZIP{required && <span className="text-error"> *</span>}
        </Label>
        <Input
          id={`${prefix}-zip`}
          value={value.zip}
          onChange={(e) => set("zip", e.target.value)}
          pattern="\d{5}(-\d{4})?"
          required={required}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-country`}>Country</Label>
        <Input
          id={`${prefix}-country`}
          value={value.country}
          onChange={(e) => set("country", e.target.value)}
        />
      </div>
    </div>
  );
}

export default AddressFields;
