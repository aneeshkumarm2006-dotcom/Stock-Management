// Polymorphic Communications tab renderer (Phase 6). Lives in the tab
// strip of Vendor / Tenant / RentalOwner / WorkOrder / Bill / Property /
// Lease / Applicant detail pages and renders the EmailMessage rows for
// that entity. Sub-tabs: History (Sent + system-generated toggle) /
// Scheduled / Drafts.
//
// BR-CC-2: when an email has >5 recipients, show `To (N) … More …` with
// an expandable popover.
// BR-CC-3: live counter badges on each sub-tab.
// BR-CC-4: `Show system generated emails` toggle on History only.
// [G-B-24]: read-receipt badge shown on History row.
"use client";

import * as React from "react";
import { CheckCircle2, Clock, AlertTriangle, Mail } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ComposeEmailModal } from "@/components/pm/ComposeEmailModal";
import type { EmailRelatedEntityType, EmailReadReceiptStatus } from "@/types/pm";

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

export interface CommunicationsTabProps {
  relatedEntityType: EmailRelatedEntityType;
  relatedEntityId: string;
  /** Hide the inline Compose button (when the parent surface offers its
   *  own composer). Defaults to false — most detail pages want the button. */
  hideCompose?: boolean;
}

function ReadReceiptBadge({ status }: { status: EmailReadReceiptStatus }) {
  if (status === "Opened") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-success"
        title="Recipient opened the email"
      >
        <CheckCircle2 className="h-3 w-3" /> Opened
      </span>
    );
  }
  if (status === "Bounced") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-error"
        title="Delivery bounced"
      >
        <AlertTriangle className="h-3 w-3" /> Bounced
      </span>
    );
  }
  if (status === "Unopened") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-warning"
        title="Awaiting open"
      >
        <Clock className="h-3 w-3" /> Unopened
      </span>
    );
  }
  return null;
}

function RecipientPreview({
  rows,
}: {
  rows: Array<{ email: string; name?: string }>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (rows.length === 0) return <span className="text-fg-muted">—</span>;
  const PREVIEW = 5;
  if (rows.length <= PREVIEW || expanded) {
    return (
      <span>
        To ({rows.length}){" "}
        <span className="text-fg-muted">
          {rows
            .map((r) => r.name || r.email)
            .filter(Boolean)
            .join(", ")}
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
        {rows
          .slice(0, PREVIEW)
          .map((r) => r.name || r.email)
          .join(", ")}
        {" "}…
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
  const d = new Date(iso);
  return d.toLocaleString();
}

function useEmailList(params: {
  relatedEntityType: string;
  relatedEntityId: string;
  view: "sent" | "scheduled" | "drafts";
  showSystemGenerated: boolean;
}) {
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);
  const reload = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({
      view: params.view,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId,
    });
    if (params.view === "sent" && params.showSystemGenerated) {
      qs.set("showSystemGenerated", "1");
    }
    fetch(`/api/pm/emails?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ListResponse | null) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    params.view,
    params.relatedEntityType,
    params.relatedEntityId,
    params.showSystemGenerated,
    reloadKey,
  ]);

  return { data, loading, reload };
}

function useCount(params: {
  relatedEntityType: string;
  relatedEntityId: string;
  view: "sent" | "scheduled" | "drafts";
}) {
  const [count, setCount] = React.useState<number | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({
      view: params.view,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId,
      countOnly: "1",
    });
    fetch(`/api/pm/emails?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (cancelled) return;
        setCount(d?.count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [params.view, params.relatedEntityType, params.relatedEntityId]);
  return count;
}

function EmailList({
  rows,
  view,
}: {
  rows: EmailRow[];
  view: "sent" | "scheduled" | "drafts";
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-surface p-6 text-center text-sm text-fg-muted">
        <Mail className="mx-auto mb-2 h-5 w-5" />
        No emails in {view}.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded border border-border bg-surface p-3 text-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-fg">{row.subject}</span>
                {row.isSystemGenerated && (
                  <span className="rounded bg-surface-high px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">
                    System
                  </span>
                )}
                {view === "sent" && (
                  <ReadReceiptBadge status={row.readReceiptStatus} />
                )}
              </div>
              <div className="mt-1 text-xs text-fg-muted">
                From <span className="text-fg">{row.fromMailbox}</span> ·{" "}
                {row.senderDisplayName}
              </div>
              <div className="mt-1 text-xs">
                <RecipientPreview rows={row.to} />
              </div>
            </div>
            <div className="shrink-0 text-right text-xs text-fg-muted">
              {view === "scheduled"
                ? fmtDate(row.scheduledSendTime)
                : view === "drafts"
                ? fmtDate(row.updatedAt)
                : fmtDate(row.sentAt)}
            </div>
          </div>
          {view === "scheduled" && (
            <div className="mt-2 flex gap-2">
              <ScheduledRowActions id={row.id} />
            </div>
          )}
          {view === "drafts" && (
            <div className="mt-2 flex gap-2">
              <DraftRowActions id={row.id} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ScheduledRowActions({ id }: { id: string }) {
  async function sendNow() {
    await fetch(`/api/pm/emails/${id}/send`, { method: "POST" });
    window.location.reload();
  }
  async function cancel() {
    await fetch(`/api/pm/emails/${id}/cancel`, { method: "POST" });
    window.location.reload();
  }
  return (
    <>
      <button
        type="button"
        className="text-xs font-bold uppercase tracking-widest text-primary hover:underline"
        onClick={sendNow}
      >
        Send now
      </button>
      <button
        type="button"
        className="text-xs font-bold uppercase tracking-widest text-fg-muted hover:text-error"
        onClick={cancel}
      >
        Cancel
      </button>
    </>
  );
}

function DraftRowActions({ id }: { id: string }) {
  async function del() {
    if (!confirm("Delete this draft?")) return;
    await fetch(`/api/pm/emails/${id}`, { method: "DELETE" });
    window.location.reload();
  }
  return (
    <button
      type="button"
      className="text-xs font-bold uppercase tracking-widest text-fg-muted hover:text-error"
      onClick={del}
    >
      Delete
    </button>
  );
}

export function CommunicationsTab({
  relatedEntityType,
  relatedEntityId,
  hideCompose,
}: CommunicationsTabProps) {
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [showSystemGenerated, setShowSystemGenerated] = React.useState(false);
  const sentCount = useCount({
    relatedEntityType,
    relatedEntityId,
    view: "sent",
  });
  const scheduledCount = useCount({
    relatedEntityType,
    relatedEntityId,
    view: "scheduled",
  });
  const draftsCount = useCount({
    relatedEntityType,
    relatedEntityId,
    view: "drafts",
  });

  const sent = useEmailList({
    relatedEntityType,
    relatedEntityId,
    view: "sent",
    showSystemGenerated,
  });
  const scheduled = useEmailList({
    relatedEntityType,
    relatedEntityId,
    view: "scheduled",
    showSystemGenerated: false,
  });
  const drafts = useEmailList({
    relatedEntityType,
    relatedEntityId,
    view: "drafts",
    showSystemGenerated: false,
  });

  return (
    <div className="space-y-4">
      {!hideCompose && (
        <div className="flex justify-end">
          <Button onClick={() => setComposeOpen(true)} size="sm">
            <Mail className="mr-1.5 h-3.5 w-3.5" /> Compose
          </Button>
        </div>
      )}
      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">
            History {sentCount !== null && `(${sentCount})`}
          </TabsTrigger>
          <TabsTrigger value="scheduled">
            Scheduled {scheduledCount !== null && `(${scheduledCount})`}
          </TabsTrigger>
          <TabsTrigger value="drafts">
            Drafts {draftsCount !== null && `(${draftsCount})`}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={showSystemGenerated}
              onChange={(e) => setShowSystemGenerated(e.target.checked)}
            />
            Show system generated emails
          </label>
          {sent.loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : (
            <EmailList rows={sent.data?.items ?? []} view="sent" />
          )}
        </TabsContent>
        <TabsContent value="scheduled" className="mt-3">
          {scheduled.loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : (
            <EmailList rows={scheduled.data?.items ?? []} view="scheduled" />
          )}
        </TabsContent>
        <TabsContent value="drafts" className="mt-3">
          {drafts.loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : (
            <EmailList rows={drafts.data?.items ?? []} view="drafts" />
          )}
        </TabsContent>
      </Tabs>
      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        relatedEntityType={relatedEntityType}
        relatedEntityId={relatedEntityId}
        onSaved={() => {
          sent.reload();
          scheduled.reload();
          drafts.reload();
        }}
      />
    </div>
  );
}

export default CommunicationsTab;
