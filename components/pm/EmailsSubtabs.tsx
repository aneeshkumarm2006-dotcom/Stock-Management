// Shared sub-tab strip for /properties/communication/emails/* pages
// (BR-CC-3). Fetches live count badges for each of the four buckets in
// parallel and links between them.
"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

type View = "list" | "scheduled" | "drafts" | "threads";

const TABS: Array<{ value: View; label: string; viewParam: View }> = [
  { value: "threads", label: "Threads", viewParam: "threads" },
  { value: "list", label: "Sent", viewParam: "list" },
  { value: "scheduled", label: "Scheduled", viewParam: "scheduled" },
  { value: "drafts", label: "Drafts", viewParam: "drafts" },
];

const VIEW_TO_API: Record<View, "threads" | "sent" | "scheduled" | "drafts"> = {
  threads: "threads",
  list: "sent",
  scheduled: "scheduled",
  drafts: "drafts",
};

export function EmailsSubtabs({ active }: { active: View }) {
  const [counts, setCounts] = React.useState<Record<View, number | null>>({
    list: null,
    scheduled: null,
    drafts: null,
    threads: null,
  });
  React.useEffect(() => {
    Promise.all(
      TABS.map(async ({ value }) => {
        const qs = new URLSearchParams({
          view: VIEW_TO_API[value],
          countOnly: "1",
        });
        const r = await fetch(`/api/pm/emails?${qs.toString()}`);
        if (!r.ok) return [value, 0] as const;
        const d = (await r.json()) as { count?: number };
        return [value, d.count ?? 0] as const;
      }),
    ).then((pairs) => {
      const next = { ...counts };
      for (const [k, v] of pairs) next[k] = v;
      setCounts(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <nav className="flex gap-2 border-b border-border">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={`/properties/communication/emails/${t.value}`}
          className={cn(
            "border-b-2 px-3 py-2 text-sm font-bold uppercase tracking-widest transition-colors",
            t.value === active
              ? "border-primary text-fg"
              : "border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {t.label}
          {counts[t.value] !== null && (
            <span className="ml-1 text-xs text-fg-muted">({counts[t.value]})</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export default EmailsSubtabs;
