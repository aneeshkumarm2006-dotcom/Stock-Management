// Minimal generic "edit summary card" for Property Management detail pages.
// Drop in a list of field descriptors and a PATCH endpoint; it renders read-
// only labels by default and swaps to inputs when the user clicks Edit.
//
// Designed for the *primary* editable surface of a detail page (name, email,
// dates, simple text/number fields). For complex multi-section layouts
// (Bills' line items, Work Orders' parts grid, Drafts' terms), use a
// dedicated Edit<Entity>Modal instead.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { EditEntityButton } from "@/components/pm/EditEntityButton";

export type FieldType =
  | "text"
  | "email"
  | "url"
  | "tel"
  | "number"
  | "date"
  | "textarea"
  | "select";

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;
  /** select-only options */
  options?: Array<{ value: string; label: string }>;
  /** Pretty-format a value for read-only display. */
  display?: (value: unknown) => React.ReactNode;
  /** Map raw record value → input string. Default identity. */
  toInput?: (value: unknown) => string;
  /** Map input string → payload value. Default identity. */
  toPayload?: (input: string) => unknown;
  placeholder?: string;
  required?: boolean;
}

interface Props<T extends Record<string, unknown>> {
  endpoint: string;
  data: T;
  fields: FieldDef[];
  onSaved: () => Promise<void> | void;
  /** Hide the Edit button (e.g., if record is in a locked status). */
  canEdit?: boolean;
  title?: string;
  /** Extra fields to send in every PATCH body (e.g., a discriminator). */
  extraPayload?: Record<string, unknown>;
  /** Reshape the flat payload (one key per field) before sending. Useful when
   *  the API expects nested objects (e.g., property `address.line1`). */
  payloadTransform?: (payload: Record<string, unknown>) => Record<string, unknown>;
}

function defaultToInput(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function dateToInput(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return "";
}

function inputToDate(v: string): string | undefined {
  return v ? new Date(v).toISOString() : undefined;
}

function numericToPayload(v: string): number | undefined {
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function InlineFieldEditor<T extends Record<string, unknown>>({
  endpoint,
  data,
  fields,
  onSaved,
  canEdit = true,
  title,
  extraPayload,
  payloadTransform,
}: Props<T>) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({});

  function start() {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const raw = data[f.key];
      if (f.toInput) {
        next[f.key] = f.toInput(raw);
      } else if (f.type === "date") {
        next[f.key] = dateToInput(raw);
      } else {
        next[f.key] = defaultToInput(raw);
      }
    }
    setForm(next);
    setEditing(true);
  }

  async function save() {
    for (const f of fields) {
      if (f.required && !form[f.key]?.trim()) {
        toast({ title: `${f.label} is required`, variant: "error" });
        return;
      }
    }
    setSaving(true);
    const payload: Record<string, unknown> = { ...(extraPayload ?? {}) };
    for (const f of fields) {
      const input = form[f.key] ?? "";
      if (f.toPayload) {
        payload[f.key] = f.toPayload(input);
      } else if (f.type === "date") {
        payload[f.key] = inputToDate(input);
      } else if (f.type === "number") {
        payload[f.key] = numericToPayload(input);
      } else {
        // Empty inputs are omitted (undefined → dropped by JSON.stringify) so
        // the API treats them as "no change" rather than "clear to null". Many
        // Zod schemas declare optional string fields as `.optional()` without
        // `.nullable()`, so a null would 400 with "Invalid input". To support
        // clearing a specific field, add `.nullable()` to its schema and use
        // a custom `toPayload` that returns null on empty input.
        const trimmed = input.trim();
        payload[f.key] = trimmed === "" ? undefined : trimmed;
      }
    }
    const finalPayload = payloadTransform ? payloadTransform(payload) : payload;
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Save failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: title ? `${title} updated` : "Updated", variant: "success" });
    setEditing(false);
    await onSaved();
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        <dl className="grid gap-3 md:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key}>
              <dt className="text-xs uppercase tracking-widest text-fg-muted">
                {f.label}
              </dt>
              <dd className="text-sm text-fg">
                {f.display
                  ? f.display(data[f.key])
                  : renderRead(data[f.key], f.type)}
              </dd>
            </div>
          ))}
        </dl>
        {canEdit && (
          <div className="flex justify-end">
            <EditEntityButton variant="header" onClick={start} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`fe-${f.key}`}>
              {f.label}
              {f.required && " *"}
            </Label>
            {renderInput(f, form[f.key] ?? "", (v) =>
              setForm((s) => ({ ...s, [f.key]: v })),
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function renderRead(value: unknown, type?: FieldType): React.ReactNode {
  if (value == null || value === "") return "—";
  if (type === "date" && typeof value === "string") {
    return new Date(value).toLocaleDateString();
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function renderInput(
  f: FieldDef,
  value: string,
  onChange: (v: string) => void,
): React.ReactNode {
  if (f.type === "textarea") {
    return (
      <textarea
        id={`fe-${f.key}`}
        rows={3}
        className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
        value={value}
        placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (f.type === "select" && f.options) {
    return (
      <select
        id={`fe-${f.key}`}
        className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {f.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      id={`fe-${f.key}`}
      type={f.type === "number" ? "number" : f.type ?? "text"}
      value={value}
      placeholder={f.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
