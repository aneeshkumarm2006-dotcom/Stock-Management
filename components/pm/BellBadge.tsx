"use client";

// Header bell badge. Polls /api/pm/notifications every 60s for unread count;
// click reveals the latest 20 in a dropdown panel.
import * as React from "react";
import { Bell } from "lucide-react";
import { useSession } from "next-auth/react";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";

interface Notif {
  id: string;
  kind: "info" | "warning" | "alert";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface FeedPayload {
  unreadCount: number;
  items: Notif[];
}

export function BellBadge() {
  const { status } = useSession();
  const [feed, setFeed] = React.useState<FeedPayload>({
    unreadCount: 0,
    items: [],
  });

  const refresh = React.useCallback(
    // STATE-013: accept the poll's AbortSignal so an in-flight notifications
    // request is cancelled on unmount (or before the next 60s tick).
    async (signal?: AbortSignal) => {
      try {
        const r = await fetch("/api/pm/notifications", {
          cache: "no-store",
          signal,
        });
        if (!r.ok) return;
        setFeed((await r.json()) as FeedPayload);
      } catch {
        /* swallow (includes AbortError) */
      }
    },
    [],
  );

  React.useEffect(() => {
    if (status !== "authenticated") return;
    // STATE-013: a single controller + cancelled flag covers the immediate
    // fetch and every interval tick; abort + clear on unmount.
    let cancelled = false;
    const controller = new AbortController();
    const tick = () => {
      if (cancelled) return;
      void refresh(controller.signal);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      controller.abort();
    };
  }, [status, refresh]);

  if (status !== "authenticated") return null;

  return (
    <Dropdown
      align="end"
      trigger={
        <span
          className="relative flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-high hover:text-fg"
          aria-label={`Notifications (${feed.unreadCount} unread)`}
        >
          <Bell className="h-4 w-4" />
          {feed.unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[9px] font-bold text-white">
              {feed.unreadCount > 99 ? "99+" : feed.unreadCount}
            </span>
          )}
        </span>
      }
    >
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-widest text-fg-muted">
          Notifications
        </p>
      </div>
      {feed.items.length === 0 ? (
        <div className="px-3 py-4 text-xs text-fg-muted">
          You&apos;re all caught up.
        </div>
      ) : (
        <>
          {feed.items.map((n) => (
            <DropdownItem key={n.id}>
              <span className="flex flex-col items-start">
                <span className="text-sm font-semibold text-fg">{n.title}</span>
                {n.body && (
                  <span className="text-xs text-fg-muted">{n.body}</span>
                )}
              </span>
            </DropdownItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export default BellBadge;
