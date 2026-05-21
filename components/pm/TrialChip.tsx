"use client";

// Trial countdown + Buy Now CTA (BR-CX-1). Reads Organization.trialEndsAt
// via /api/pm/organization. Renders nothing for non-PM workspaces or before
// the session resolves.
import * as React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils/cn";

interface OrgPayload {
  trialEndsAt: string;
  subscriptionStatus: "trial" | "active" | "expired";
}

export function TrialChip() {
  const { data: session, status } = useSession();
  const [org, setOrg] = React.useState<OrgPayload | null>(null);

  React.useEffect(() => {
    if (status !== "authenticated" || !session?.user?.orgId) return;
    let cancelled = false;
    fetch("/api/pm/organization")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setOrg(d as OrgPayload);
      })
      .catch(() => {
        // silent — the chip is non-critical UI
      });
    return () => {
      cancelled = true;
    };
  }, [status, session?.user?.orgId]);

  if (!org || org.subscriptionStatus !== "trial") return null;

  const daysLeft = Math.max(
    0,
    Math.ceil(
      (new Date(org.trialEndsAt).getTime() - Date.now()) /
        (24 * 60 * 60 * 1000),
    ),
  );
  const urgent = daysLeft <= 3;

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest",
          urgent ? "bg-error/10 text-error" : "bg-tertiary/15 text-tertiary",
        )}
      >
        Trial: {daysLeft} day{daysLeft === 1 ? "" : "s"} left
      </span>
      <Link
        href="/settings/pm"
        className="rounded bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-fg hover:bg-primary-container"
      >
        Buy now
      </Link>
    </div>
  );
}

export default TrialChip;
