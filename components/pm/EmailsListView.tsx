// Shared list view for /properties/communication/emails/{list,scheduled,
// drafts}. Pulls /api/pm/emails?view=X, renders rows with the BR-CC-2
// "To (N) ... More …" ellipsis, the BR-CC-4 system-generated toggle (on
// Sent only), and per-row actions (Send now / Cancel / Delete).
"use client";

import * as React from "react";
import { CheckCircle2, Clock, AlertTriangle, Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ComposeEmailModal } from "@/components/pm/ComposeEmailModal";
import type { EmailReadReceiptStatus } from "@/types/pm";

interface EmailRow {
  id: string;
  subject: string;
  fromMailbox: string;
  to: Array<{ type: string; email: string; name?: string }>;
  cc: Array<{ type: string; email: string; name?: string }>;
  bcc: Array<{ type: string; email: string; name?: string }>;
  recipientCount: number;
  status: string;
  isSystemGenerated: boolean;
  readReceiptStatus: EmailReadReceiptStatus;
  sentAt: string | null;
  scheduledSendTime: string | null;
  senderDisplayName: string;
  updatedAt: string;
  createdAt: string;
}

interface ListResponse {
  view: string;
  total: number;
  page: number;
  pageSize: number;
  items: EmailRow[];
}

export type ListMode = "sent" | "scheduled" | "drafts";

function ReadReceiptBadge({ status }: { status: EmailReadReceiptStatus }) {
  if (status === "Opened") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-success">
        <CheckCircle2 className="h-3 w-3" /> Opened
      </span>
    );
  }
  if (status === "Bounced") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-error">
        <AlertTriangle className="h-3 w-3" /> Bounced
      </span>
    );
  }
  if (status === "Unopened") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-warning">
        <Clock className="h-3 w-3" /> Unopened
      </span>
    );
  }
  return null;
}

function ToColumn({ rows }: { rows: EmailRow["to"] }) {
  const [expanded, setExpanded] = React.useState(false);
  if (rows.length === 0) return <span className="text-fg-muted">—</span>;
  const PREVIEW = 5;
  if (rows.length <= PREVIEW || expanded) {
    return (
      <span>
        To ({rows.length}){" "}
        <span className="text-fg-muted">
          {rows.map((r) => r.name || r.email).join(", ")}
        </span>
        {rows.length > PREVIEW && (
          <button
            type="button"
            className="ml-2 text-xs text-primary hover:underline"
            onClick={() => setExpanded(false)}
          >
            Hide
          </button>
        )}
      </span>
    );
  }
  return (
    <span>
      To ({rows.length}){" "}
      <span className="text-fg-muted">
        {rows.slice(0, PREVIEW).map((r) => r.name || r.email).join(", ")} …
      </span>{" "}
      <button
        type="button"
        className="text-xs text-primary hover:underline"
        onClick={() => setExpanded(true)}
      >
        More …
      </button>
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function EmailsListView({ mode }: { mode: ListMode }) {
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [showSystemGenerated, setShowSystemGenerated] = React.useState(false);
  const [q, setQ] = React.useState("");
  // STATE-004: debounce the raw input so keystrokes don't fire a request each.
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  React.useEffect(() => {
    let cancelled = false;
    // STATE-004: cancel any in-flight request when q/mode/filters change so a
    // slow earlier response can't overwrite a newer one (response-order race).
    const controller = new AbortController();
    setLoading(true);
    const qs = new URLSearchParams({ view: mode });
    if (mode === "sent" && showSystemGenerated) qs.set("showSystemGenerated", "1");
    if (debouncedQ.trim()) qs.set("q", debouncedQ.trim());
    fetch(`/api/pm/emails?${qs.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ListResponse | null) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode, showSystemGenerated, debouncedQ, reload]);

  async function sendNow(id: string) {
    await fetch(`/api/pm/emails/${id}/send`, { method: "POST" });
    setReload((r) => r + 1);
  }
  async function cancel(id: string) {
    await fetch(`/api/pm/emails/${id}/cancel`, { method: "POST" });
    setReload((r) => r + 1);
  }
  async function del(id: string) {
    if (!confirm("Delete this draft?")) return;
    await fetch(`/api/pm/emails/${id}`, { method: "DELETE" });
    setReload((r) => r + 1);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3">
          <Input
            placeholder="Search subjects…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          {mode === "sent" && (
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={showSystemGenerated}
                onChange={(e) => setShowSystemGenerated(e.target.checked)}
              />
              Show system generated emails
            </label>
          )}
        </div>
        <Button size="sm" onClick={() => setComposeOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Compose email
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface p-6 text-center text-sm text-fg-muted">
          <Mail className="mx-auto mb-2 h-5 w-5" />
          No emails in {mode}.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.items.map((row) => (
            <li
              key={row.id}
              className="rounded border border-border bg-surface p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-fg">{row.subject}</span>
                    {row.isSystemGenerated && (
                      <span className="rounded bg-surface-high px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">
                        System
                      </span>
                    )}
                    {mode === "sent" && (
                      <ReadReceiptBadge status={row.readReceiptStatus} />
                    )}
                  </div>
                  <div className="mt-1 text-xs text-fg-muted">
                    From <span className="text-fg">{row.fromMailbox}</span>{" "}
                    · {row.senderDisplayName}
                  </div>
                  <div className="mt-1 text-xs">
                    <ToColumn rows={row.to} />
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-fg-muted">
                  {mode === "scheduled"
                    ? fmtDate(row.scheduledSendTime)
                    : mode === "drafts"
                    ? fmtDate(row.updatedAt)
                    : fmtDate(row.sentAt)}
                </div>
              </div>
              {mode === "scheduled" && (
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    className="text-xs font-bold uppercase tracking-widest text-primary hover:underline"
                    onClick={() => sendNow(row.id)}
                  >
                    Send now
                  </button>
                  <button
                    type="button"
                    className="text-xs font-bold uppercase tracking-widest text-fg-muted hover:text-error"
                    onClick={() => cancel(row.id)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {mode === "drafts" && (
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    className="text-xs font-bold uppercase tracking-widest text-fg-muted hover:text-error"
                    onClick={() => del(row.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSaved={() => setReload((r) => r + 1)}
      />
    </div>
  );
}

export default EmailsListView;
