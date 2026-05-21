"use client";

// Polymorphic Event-history renderer (PDR_MASTER §3.38). Drop into the
// `Event history` tab on every PM detail page.
import * as React from "react";
import { format } from "date-fns";
import type { ParentType } from "@/types/pm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ActivityEntry {
  id: string;
  parentType: ParentType;
  parentId: string;
  eventType: string;
  actorUserId: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface Props {
  parentType: ParentType;
  parentId: string;
}

export function ActivityLog({ parentType, parentId }: Props) {
  const [items, setItems] = React.useState<ActivityEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/pm/activity?parentType=${parentType}&parentId=${parentId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled) setItems(d as ActivityEntry[]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parentType, parentId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event history</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-fg-muted">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-fg-muted">No events recorded yet.</p>
        )}
        <ol className="space-y-2 text-sm">
          {items.map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-4 border-b border-border/40 pb-2 last:border-b-0"
            >
              <span className="text-fg">{e.eventType}</span>
              <span className="shrink-0 text-xs text-fg-muted">
                {format(new Date(e.createdAt), "yyyy-MM-dd HH:mm")}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export default ActivityLog;
