"use client";

// Fixed bottom-right floating action cluster for the PM workspace
// (PROPERTY_TODO.md Phase 0 + Phase 10). Stacked top→bottom in the order the
// Buildium reference shows: Trial countdown / Buy now → Ace Applications →
// Compose Email. Hidden in the Stocks workspace since none apply there.
import { usePathname } from "next/navigation";
import { getWorkspaceForPath } from "@/components/layout/nav";
import { ComposeEmailButton } from "@/components/pm/ComposeEmailButton";
import { AceApplicationsPill } from "@/components/pm/AceApplicationsPill";
import { TrialChip } from "@/components/pm/TrialChip";

export function FloatingActionCluster() {
  const pathname = usePathname();
  if (getWorkspaceForPath(pathname) !== "pm") return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      <div className="pointer-events-auto">
        <TrialChip />
      </div>
      <div className="pointer-events-auto">
        <AceApplicationsPill />
      </div>
      <div className="pointer-events-auto">
        <ComposeEmailButton />
      </div>
    </div>
  );
}

export default FloatingActionCluster;
