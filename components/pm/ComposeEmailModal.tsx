// Compose Email modal (Phase 6, [G-B-20] = Dialog modal). Mirrors the
// AddWorkOrderModal pattern. Supports:
//   - From mailbox (defaults to Organization.senderMailbox.defaultFrom).
//   - To / Cc / Bcc recipient picker — Tenant / RentalOwner / Vendor /
//     Applicant / Property (BR-CC-8 blast) / Lease / Custom email.
//   - Template selection (loads from /api/pm/emails/templates).
//   - Subject + Body (textarea — rich-text deferred per Phase 6 scope cut).
//   - Schedule send (datetime-local converted to UTC).
//   - Buttons: Send now | Save draft | Schedule.
"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
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
  EMAIL_RECIPIENT_TYPES,
  type EmailRecipientType,
  type EmailRelatedEntityType,
} from "@/types/pm";

// Outbound sender is currently funneled through a single authenticated SMTP
// mailbox (see `lib/pm/emailTransport.ts`). Multi-sender support (per-mailbox
// SMTP / Gmail OAuth / domain-verified provider) is on the roadmap.
const LOCKED_FROM_MAILBOX = "automations@davnoot.com";

interface RecipientRow {
  type: EmailRecipientType;
  id: string | null;
  email: string;
  name: string;
}

interface EntityOption {
  id: string;
  label: string;
  email: string;
}

interface TemplateOption {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface ComposeEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => Promise<void> | void;
  /** Polymorphic anchor — when set, the email's Comms-tab surface is
   *  pre-stamped (Vendor / Property / Lease / etc detail page). */
  relatedEntityType?: EmailRelatedEntityType | null;
  relatedEntityId?: string | null;
  /** Pre-populated recipients (e.g. a Vendor detail's "Compose" button
   *  injects the vendor as a `To` entry). */
  defaultTo?: RecipientRow[];
  /** Optional From override; falls back to org default. */
  defaultMailbox?: string;
}

const EMPTY_RECIPIENT: RecipientRow = {
  type: "Custom",
  id: null,
  email: "",
  name: "",
};

function blank(): RecipientRow {
  return { ...EMPTY_RECIPIENT };
}

/** Convert a `datetime-local` input value (in the user's local TZ) into
 *  a UTC ISO string. Required because the server stores scheduledSendTime
 *  in UTC ([G-B-23]). */
function localInputToUtcIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Fetch options for the per-row entity picker. Each type has its own
 *  endpoint shape, so this normalises into {id, label, email}. */
async function fetchOptions(
  type: EmailRecipientType,
  q: string,
): Promise<EntityOption[]> {
  if (type === "Custom") return [];
  const qs = new URLSearchParams(q ? { q } : undefined);
  try {
    switch (type) {
      case "Tenant": {
        const r = await fetch(`/api/pm/tenants?${qs}`);
        if (!r.ok) return [];
        const rows: Array<{ id: string; displayName: string; email: string }> =
          await r.json();
        return rows.map((row) => ({
          id: row.id,
          label: row.displayName,
          email: row.email,
        }));
      }
      case "RentalOwner": {
        const r = await fetch(`/api/pm/rental-owners?${qs}`);
        if (!r.ok) return [];
        const rows = (await r.json()) as Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          companyName?: string;
          isCompany?: boolean;
          primaryEmail?: string;
        }>;
        return rows.map((r2) => ({
          id: r2.id,
          label: r2.isCompany
            ? r2.companyName ?? "(unnamed)"
            : `${r2.firstName ?? ""} ${r2.lastName ?? ""}`.trim() || "(unnamed)",
          email: r2.primaryEmail ?? "",
        }));
      }
      case "Vendor": {
        const r = await fetch(`/api/pm/vendors?${qs}`);
        if (!r.ok) return [];
        const rows = (await r.json()) as Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          companyName?: string;
          isCompany?: boolean;
          primaryEmail?: string;
        }>;
        return rows.map((r2) => ({
          id: r2.id,
          label: r2.isCompany
            ? r2.companyName ?? "(unnamed)"
            : `${r2.firstName ?? ""} ${r2.lastName ?? ""}`.trim() || "(unnamed)",
          email: r2.primaryEmail ?? "",
        }));
      }
      case "Applicant": {
        const r = await fetch(`/api/pm/applicants?${qs}`);
        if (!r.ok) return [];
        const rows = (await r.json()) as Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          email?: string;
        }>;
        return rows.map((row) => ({
          id: row.id,
          label: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
          email: row.email ?? "",
        }));
      }
      case "Property": {
        const r = await fetch(`/api/pm/properties?${qs}`);
        if (!r.ok) return [];
        const rows = (await r.json()) as Array<{
          id: string;
          propertyName?: string;
          address?: { line1?: string };
        }>;
        return rows.map((row) => ({
          id: row.id,
          label: row.propertyName ?? row.address?.line1 ?? "(unnamed)",
          email: "(blast)",
        }));
      }
      case "Lease": {
        // The leases API does not support `?q=` filtering and never returns a
        // `displayName`, so we fetch unfiltered and compose the label from
        // `leaseNumber` + tenant names client-side (the search input is hidden
        // for this picker type — see RecipientPicker).
        const r = await fetch(`/api/pm/leases`);
        if (!r.ok) return [];
        const rows = (await r.json()) as Array<{
          id: string;
          leaseNumber?: number;
          tenants?: Array<{
            firstName?: string;
            lastName?: string;
            companyName?: string;
          }>;
        }>;
        return rows.map((row) => {
          const names = (row.tenants ?? [])
            .map((t) =>
              (t.companyName?.trim() ||
                `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim()) ?? "",
            )
            .filter(Boolean)
            .join(", ");
          const numberLabel =
            row.leaseNumber != null
              ? `Lease #${row.leaseNumber}`
              : `Lease ${row.id.slice(-6)}`;
          return {
            id: row.id,
            label: names ? `${numberLabel} — ${names}` : numberLabel,
            email: "(blast)",
          };
        });
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

function RecipientList({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: RecipientRow[];
  onChange: (rows: RecipientRow[]) => void;
}) {
  return (
    <div className="space-y-2 rounded border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">
          {label}
          {rows.length > 0 && ` (${rows.length})`}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-primary hover:underline"
          onClick={() => onChange([...rows, blank()])}
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-fg-muted">No recipients selected.</p>
      )}
      {rows.map((row, idx) => (
        <RecipientPicker
          key={idx}
          value={row}
          onChange={(next) => {
            const copy = [...rows];
            copy[idx] = next;
            onChange(copy);
          }}
          onRemove={() => onChange(rows.filter((_, i) => i !== idx))}
        />
      ))}
    </div>
  );
}

function RecipientPicker({
  value,
  onChange,
  onRemove,
}: {
  value: RecipientRow;
  onChange: (row: RecipientRow) => void;
  onRemove: () => void;
}) {
  const [options, setOptions] = React.useState<EntityOption[]>([]);
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    if (value.type === "Custom") {
      setOptions([]);
      return;
    }
    let cancelled = false;
    fetchOptions(value.type, q).then((opts) => {
      if (!cancelled) setOptions(opts);
    });
    return () => {
      cancelled = true;
    };
  }, [value.type, q]);

  return (
    <div className="grid gap-2 md:grid-cols-[140px_1fr_auto]">
      <select
        className="w-full rounded border border-border bg-surface-high px-2 py-1.5 text-sm text-fg"
        value={value.type}
        onChange={(e) =>
          onChange({
            type: e.target.value as EmailRecipientType,
            id: null,
            email: "",
            name: "",
          })
        }
      >
        {EMAIL_RECIPIENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {value.type === "Custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="email@example.com"
            value={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
          />
          <Input
            placeholder="Display name (optional)"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </div>
      ) : (
        <div
          className={
            value.type === "Lease"
              ? "grid grid-cols-1 gap-2"
              : "grid grid-cols-[1fr_1.5fr] gap-2"
          }
        >
          {value.type !== "Lease" && (
            <Input
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          <select
            className="w-full rounded border border-border bg-surface-high px-2 py-1.5 text-sm text-fg"
            value={value.id ?? ""}
            onChange={(e) => {
              const opt = options.find((o) => o.id === e.target.value);
              onChange({
                ...value,
                id: e.target.value || null,
                email: opt?.email ?? "",
                name: opt?.label ?? "",
              });
            }}
          >
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} {o.email && `— ${o.email}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="button"
        aria-label="Remove recipient"
        onClick={onRemove}
        className="text-fg-muted transition-colors hover:text-error"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ComposeEmailModal({
  open,
  onOpenChange,
  onSaved,
  relatedEntityType,
  relatedEntityId,
  defaultTo,
  defaultMailbox,
}: ComposeEmailModalProps) {
  const { toast } = useToast();
  const [from, setFrom] = React.useState(LOCKED_FROM_MAILBOX);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [to, setTo] = React.useState<RecipientRow[]>(defaultTo ?? []);
  const [cc, setCc] = React.useState<RecipientRow[]>([]);
  const [bcc, setBcc] = React.useState<RecipientRow[]>([]);
  const [scheduleAt, setScheduleAt] = React.useState("");
  const [templates, setTemplates] = React.useState<TemplateOption[]>([]);
  const [templateId, setTemplateId] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // From mailbox is locked to LOCKED_FROM_MAILBOX while multi-sender support
    // is on the roadmap — skip the org default fetch.
    fetch(`/api/pm/emails/templates`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.items) return;
        setTemplates(data.items);
      });
  }, [open, defaultMailbox]);

  React.useEffect(() => {
    if (!open) {
      setFrom(LOCKED_FROM_MAILBOX);
      setSubject("");
      setBody("");
      setTo(defaultTo ?? []);
      setCc([]);
      setBcc([]);
      setScheduleAt("");
      setTemplateId("");
      setSaving(false);
    }
  }, [open, defaultMailbox, defaultTo]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (!id) return;
    const t = templates.find((tpl) => tpl.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
  }

  function payloadFor(action: "send" | "schedule" | "draft") {
    return {
      action,
      fromMailbox: from,
      subject,
      body,
      to: to.map((r) => ({
        type: r.type,
        id: r.id,
        email: r.type === "Custom" ? r.email : r.email || "placeholder@x.com",
        name: r.name || undefined,
      })),
      cc: cc.map((r) => ({
        type: r.type,
        id: r.id,
        email: r.type === "Custom" ? r.email : r.email || "placeholder@x.com",
        name: r.name || undefined,
      })),
      bcc: bcc.map((r) => ({
        type: r.type,
        id: r.id,
        email: r.type === "Custom" ? r.email : r.email || "placeholder@x.com",
        name: r.name || undefined,
      })),
      attachmentFileIds: [],
      templateId: templateId || undefined,
      scheduledSendTime:
        action === "schedule" ? localInputToUtcIso(scheduleAt) : undefined,
      relatedEntityType: relatedEntityType ?? undefined,
      relatedEntityId: relatedEntityId ?? undefined,
    };
  }

  async function submit(action: "send" | "schedule" | "draft") {
    setSaving(true);
    try {
      const res = await fetch(`/api/pm/emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFor(action)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        toast({
          title: "Could not send email",
          description: err.error ?? "Validation failed",
        });
        setSaving(false);
        return;
      }
      const data = await res.json();
      toast({
        title:
          action === "send"
            ? "Email sent"
            : action === "schedule"
            ? "Email scheduled"
            : "Draft saved",
        description: `Recipients: ${data.recipientCount ?? 0}`,
      });
      onOpenChange(false);
      if (onSaved) await onSaved();
    } catch (err) {
      toast({
        title: "Network error",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader
          title="Compose email"
          description={
            relatedEntityType
              ? `This email will be linked to a ${relatedEntityType} record.`
              : undefined
          }
          onClose={() => onOpenChange(false)}
        />
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="space-y-1">
              <Label htmlFor="email-from">From mailbox *</Label>
              <Input
                id="email-from"
                value={from}
                readOnly
                aria-readonly
                tabIndex={-1}
                className="cursor-not-allowed bg-surface-high text-fg-muted"
              />
              <p className="text-xs text-fg-muted">
                Sending from custom mailboxes is coming soon — for now all
                outbound mail is sent from{" "}
                <code>{LOCKED_FROM_MAILBOX}</code>.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-template">Template</Label>
              <select
                id="email-template"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                <option value="">No template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <RecipientList label="To" rows={to} onChange={setTo} />
          <RecipientList label="Cc" rows={cc} onChange={setCc} />
          <RecipientList label="Bcc" rows={bcc} onChange={setBcc} />

          <div className="space-y-1">
            <Label htmlFor="email-subject">Subject *</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email-body">Body</Label>
            <textarea
              id="email-body"
              rows={10}
              className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-fg"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your email…"
            />
            <p className="text-xs text-fg-muted">
              Rich-text editing lands in a later phase. Template variables
              like <code>{`{{tenantName}}`}</code> are substituted at send time.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="email-schedule">Schedule send</Label>
              <Input
                id="email-schedule"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              <p className="text-xs text-fg-muted">
                Stored in UTC; rendered in your org timezone.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => submit("draft")}
          >
            Save draft
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={saving || !scheduleAt}
            onClick={() => submit("schedule")}
          >
            Schedule
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            onClick={() => submit("send")}
          >
            Send now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ComposeEmailModal;
