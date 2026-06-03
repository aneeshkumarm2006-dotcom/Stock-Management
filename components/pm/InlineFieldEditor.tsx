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
  /** EDIT-001: When true, an emptied input is sent as `null` (clear the field)
   *  instead of being omitted. Use only when the API schema for this field is
   *  `.nullable()` — e.g. project.dueDate, tenant.dateOfBirth. Fields that are
   *  non-null at edit start are *also* treated as clearable automatically (the
   *  user clearing an existing value clearly intends to clear it); set this
   *  flag for fields that may start empty but should still be clearable.
   *  Defaults to undefined → legacy behavior (empty omitted as "no change"). */
  clearable?: boolean;
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

// EDIT-003: A <input type="date"> yields a bare "YYYY-MM-DD". `new Date(s)`
// parses that as **UTC midnight**, so in UTC-negative zones the read-only
// display (`new Date(value).toLocaleDateString()`, ~line 223) renders the
// previous calendar day. We anchor the instant to **local noon** before
// serializing: noon ± 14h of UTC offset never crosses a day boundary, so the
// stored ISO datetime round-trips back to the same calendar day everywhere.
// We keep emitting a full ISO datetime (not a bare "YYYY-MM-DD") because some
// update schemas accept only `z.string().datetime()` (tenant.dateOfBirth,
// workOrder.dueDate, rentalOwner.* ), while every date schema accepts ISO.
// Returns `null` for empty input so callers can distinguish "cleared" from
// "untouched"; the dirty-tracking in save() decides whether to send it.
function inputToDate(v: string): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (m) {
    const [, y, mo, d] = m;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      12,
      0,
      0,
      0,
    ).toISOString();
  }
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// EDIT-001: returns `null` for empty input (not undefined) so an emptied number
// field can be sent as a clear when appropriate. Non-numeric junk also maps to
// null. save() gates whether the null is actually included in the body.
function numericToPayload(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  // EDIT-002 + EDIT-020: the form values captured at edit start. Diffing the
  // live `form` against this snapshot powers both dirty-only PATCH bodies and
  // the unsaved-changes guard on Cancel/Escape. A single snapshot serves both.
  const [initial, setInitial] = React.useState<Record<string, string>>({});

  // Build the string form-state for the current `data`/`fields`.
  const buildForm = React.useCallback((): Record<string, string> => {
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
    return next;
  }, [data, fields]);

  function start() {
    const next = buildForm();
    setForm(next);
    setInitial(next);
    setEditing(true);
  }

  // EDIT-002: while NOT editing, re-sync `form`/`initial` whenever the record
  // changes underneath us (e.g. a sibling save or a poll refreshed `data`).
  // Keyed on `updatedAt` so we don't clobber an in-progress edit. If the record
  // has no `updatedAt`, this is a no-op and behavior is unchanged.
  const updatedAt = (data as { updatedAt?: unknown }).updatedAt;
  React.useEffect(() => {
    if (editing) return;
    const next = buildForm();
    setForm(next);
    setInitial(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);

  // EDIT-001 + EDIT-002: compute the payload value for one field from its
  // current input string. `null` means "explicitly cleared"; `undefined` means
  // "no value / legacy-omit". The caller decides inclusion based on dirtiness.
  function fieldToPayloadValue(f: FieldDef, input: string): unknown {
    if (f.toPayload) return f.toPayload(input);
    if (f.type === "date") return inputToDate(input); // null when emptied
    if (f.type === "number") return numericToPayload(input); // null when emptied
    const trimmed = input.trim();
    if (trimmed !== "") return trimmed;
    // Empty string. EDIT-001: send `null` (clear) when the field is clearable —
    // either explicitly flagged, or it held a non-empty value at edit start, so
    // emptying it is an intentional clear. Otherwise keep legacy behavior and
    // omit it (undefined → dropped by JSON.stringify) so `.optional()`-only
    // schemas don't 400 on an unexpected null.
    const startedNonEmpty = (initial[f.key] ?? "").trim() !== "";
    return f.clearable || startedNonEmpty ? null : undefined;
  }

  function isDirty(): boolean {
    return fields.some((f) => (form[f.key] ?? "") !== (initial[f.key] ?? ""));
  }

  // EDIT-002: drop keys whose value is `undefined`, and recursively prune nested
  // plain objects so a transform that maps absent flat keys to
  // `{ sub: undefined, ... }` collapses to nothing rather than overwriting the
  // server's value with an empty object (protects property `address.*`).
  function pruneUndefined(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        const nested = pruneUndefined(v as Record<string, unknown>);
        if (Object.keys(nested).length === 0) continue;
        out[k] = nested;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  async function save() {
    for (const f of fields) {
      if (f.required && !form[f.key]?.trim()) {
        toast({ title: `${f.label} is required`, variant: "error" });
        return;
      }
    }

    // EDIT-002: only send fields the user actually changed. A field is dirty
    // when its current input differs from the edit-start snapshot. EDIT-001: a
    // cleared field is dirty AND carries a `null`, so it both qualifies here and
    // survives JSON.stringify as an explicit clear.
    const flat: Record<string, unknown> = {};
    for (const f of fields) {
      const input = form[f.key] ?? "";
      const dirty = input !== (initial[f.key] ?? "");
      if (!dirty) continue;
      flat[f.key] = fieldToPayloadValue(f, input);
    }

    const merged: Record<string, unknown> = { ...(extraPayload ?? {}), ...flat };
    const transformed = payloadTransform ? payloadTransform(merged) : merged;
    const finalPayload = pruneUndefined(transformed);

    // EDIT-002: never send an empty PATCH — every update schema rejects a body
    // with no fields ("No fields to update" 400). If nothing is dirty, treat it
    // as a successful no-op so the toast isn't a lie and Cancel/Save feel the
    // same when untouched.
    const hasFields = Object.keys(finalPayload).filter(
      (k) => !(extraPayload && k in extraPayload),
    ).length;
    if (hasFields === 0) {
      setEditing(false);
      return;
    }

    setSaving(true);
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

  // EDIT-020: discard edits only after confirming when the form is dirty.
  function cancel() {
    if (saving) return;
    if (isDirty() && !window.confirm("Discard changes?")) return;
    setForm(initial);
    setEditing(false);
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
    <div
      className="space-y-3"
      onKeyDown={(e) => {
        // EDIT-020: Escape cancels with the same discard guard as the button.
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
    >
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
          onClick={cancel}
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
    // EDIT-003: Older records may hold a UTC-midnight instant
    // ("2026-05-30T00:00:00.000Z"). Rendering that with toLocaleDateString in a
    // UTC-negative zone shows the previous day. Extract the calendar date from
    // the leading YYYY-MM-DD and re-anchor to local noon so the displayed day
    // matches what was entered, independent of the viewer's timezone.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) {
      const [, y, mo, d] = m;
      return new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        12,
      ).toLocaleDateString();
    }
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
