"use client";

// Reads org-scoped CustomFieldDefinition rows for a given entityType and
// renders a controlled grid of inputs that any Phase 1+ detail page can
// drop in. Values land on the consuming entity's `customFields` map.
import * as React from "react";
import type { CustomFieldType } from "@/types/pm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FieldDef {
  id: string;
  entityType: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  enumOptions: string[] | null;
  required: boolean;
  order: number;
  active: boolean;
}

type CustomFieldValue = string | number | boolean | null;

interface Props {
  entityType: string;
  values: Record<string, CustomFieldValue>;
  onChange: (key: string, value: CustomFieldValue) => void;
  disabled?: boolean;
}

export function CustomFieldsRenderer({
  entityType,
  values,
  onChange,
  disabled,
}: Props) {
  const [defs, setDefs] = React.useState<FieldDef[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/pm/custom-fields?entityType=${encodeURIComponent(entityType)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled) setDefs(d as FieldDef[]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType]);

  if (loading) {
    return <p className="text-sm text-fg-muted">Loading custom fields…</p>;
  }
  if (defs.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {defs.map((f) => {
        const id = `cf-${f.key}`;
        const v = values[f.key];
        switch (f.fieldType) {
          case "boolean":
            return (
              <label key={f.id} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={Boolean(v)}
                  onChange={(e) => onChange(f.key, e.target.checked)}
                  disabled={disabled}
                />
                {f.label}
                {f.required && <span className="text-error">*</span>}
              </label>
            );
          case "enum":
            return (
              <div key={f.id} className="space-y-1">
                <Label htmlFor={id}>
                  {f.label}
                  {f.required && <span className="text-error"> *</span>}
                </Label>
                <select
                  id={id}
                  value={(v as string) ?? ""}
                  onChange={(e) => onChange(f.key, e.target.value || null)}
                  disabled={disabled}
                  required={f.required}
                  className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
                >
                  <option value="">—</option>
                  {(f.enumOptions ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            );
          case "number":
            return (
              <div key={f.id} className="space-y-1">
                <Label htmlFor={id}>
                  {f.label}
                  {f.required && <span className="text-error"> *</span>}
                </Label>
                <Input
                  id={id}
                  type="number"
                  value={typeof v === "number" ? v : ""}
                  onChange={(e) =>
                    onChange(f.key, e.target.value === "" ? null : Number(e.target.value))
                  }
                  disabled={disabled}
                  required={f.required}
                />
              </div>
            );
          case "date":
            return (
              <div key={f.id} className="space-y-1">
                <Label htmlFor={id}>
                  {f.label}
                  {f.required && <span className="text-error"> *</span>}
                </Label>
                <Input
                  id={id}
                  type="date"
                  value={(v as string) ?? ""}
                  onChange={(e) => onChange(f.key, e.target.value || null)}
                  disabled={disabled}
                  required={f.required}
                />
              </div>
            );
          case "text":
          default:
            return (
              <div key={f.id} className="space-y-1">
                <Label htmlFor={id}>
                  {f.label}
                  {f.required && <span className="text-error"> *</span>}
                </Label>
                <Input
                  id={id}
                  type="text"
                  value={(v as string) ?? ""}
                  onChange={(e) => onChange(f.key, e.target.value || null)}
                  disabled={disabled}
                  required={f.required}
                />
              </div>
            );
        }
      })}
    </div>
  );
}

export default CustomFieldsRenderer;
