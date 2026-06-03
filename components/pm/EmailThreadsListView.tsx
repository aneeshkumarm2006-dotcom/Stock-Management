// Threads sub-route view — groups EmailMessage rows by EmailThread row.
// Phase 6: read-only. Real reply ingestion lights this up via the
// /api/pm/emails/ingest webhook.
"use client";

import * as React from "react";
import { Users, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ThreadRow {
  id: string;
  subject: string;
  participants: Array<{ email: string; name?: string }>;
  participantCount: number;
  messageCount: number;
  lastActivityTime: string;
}

interface ThreadsResponse {
  view: string;
  total: number;
  page: number;
  pageSize: number;
  items: ThreadRow[];
}

export function EmailThreadsListView() {
  const [data, setData] = React.useState<ThreadsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState("");
  // STATE-005: debounce the search input.
  const [debouncedQ, setDebouncedQ] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  React.useEffect(() => {
    let cancelled = false;
    // STATE-005: abort any superseded request so an older response can't land
    // after a newer one (response-order race).
    const controller = new AbortController();
    setLoading(true);
    const qs = new URLSearchParams({ view: "threads" });
    if (debouncedQ.trim()) qs.set("q", debouncedQ.trim());
    fetch(`/api/pm/emails?${qs.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ThreadsResponse | null) => {
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
  }, [debouncedQ]);

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search subjects…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-xs"
      />
      {loading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface p-6 text-center text-sm text-fg-muted">
          <MessageSquare className="mx-auto mb-2 h-5 w-5" />
          No conversation threads yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.items.map((t) => (
            <li
              key={t.id}
              className="rounded border border-border bg-surface p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-fg">{t.subject}</p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-muted">
                    <Users className="h-3 w-3" />
                    {t.participantCount} participant
                    {t.participantCount === 1 ? "" : "s"} ·{" "}
                    {t.messageCount} message
                    {t.messageCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-fg-muted">
                  {new Date(t.lastActivityTime).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default EmailThreadsListView;
