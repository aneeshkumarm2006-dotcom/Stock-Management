"use client";

// Polymorphic Event-history renderer (PDR_MASTER §3.38). Drop into the
// `Event history` tab on every PM detail page.
import { useQuery } from "@tanstack/react-query";
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

// STATE-009: shared key shape `['pm','activity',parentType,parentId]` so a
// mutation elsewhere (e.g. adding a note, sending an email) can invalidate this
// log with `queryClient.invalidateQueries({ queryKey: ['pm','activity'] })`
// instead of the previous raw fetch that TanStack Query could never see.
export function activityLogQueryKey(parentType: ParentType, parentId: string) {
  return ["pm", "activity", parentType, parentId] as const;
}

async function fetchActivity(
  parentType: ParentType,
  parentId: string,
  signal?: AbortSignal,
): Promise<ActivityEntry[]> {
  const res = await fetch(
    `/api/pm/activity?parentType=${parentType}&parentId=${parentId}`,
    { signal },
  );
  if (!res.ok) return [];
  return (await res.json()) as ActivityEntry[];
}

export function ActivityLog({ parentType, parentId }: Props) {
  const { data: items = [], isPending: loading } = useQuery({
    queryKey: activityLogQueryKey(parentType, parentId),
    queryFn: ({ signal }) => fetchActivity(parentType, parentId, signal),
  });

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
