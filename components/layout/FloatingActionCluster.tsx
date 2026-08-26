"use client";

import { usePathname } from "next/navigation";
import { getWorkspaceForPath } from "@/components/layout/nav";
import { ComposeEmailButton } from "@/components/pm/ComposeEmailButton";

/**
 * Bottom padding a PM page must reserve so its own content can always be
 * scrolled clear of the floating Compose-email button.
 *
 * The cluster sits at `bottom-6` (24px) and is 48px tall, so it occupies the
 * last 72px of the viewport. The dashboard shell's `main` only pads 28px at
 * the foot on desktop, which left the tail of long tables — the Financials
 * NET row, the last recurring rules — permanently underneath the button with
 * no way to scroll them out. Reserving 72px + a 24px breathing gap means the
 * button overlaps empty space instead of data.
 *
 * Applied by app/(dashboard)/properties/layout.tsx, which is scoped to exactly
 * the routes where `getWorkspaceForPath` renders the cluster — the stock
 * workspace has no FAB and keeps its original spacing.
 */
export const FAB_SAFE_AREA_CLASS = "pb-24";

export function FloatingActionCluster() {
  const pathname = usePathname();
  if (getWorkspaceForPath(pathname) !== "pm") return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      <div className="pointer-events-auto">
        <ComposeEmailButton />
      </div>
    </div>
  );
}

export default FloatingActionCluster;
