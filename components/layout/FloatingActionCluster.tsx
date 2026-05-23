"use client";

import { usePathname } from "next/navigation";
import { getWorkspaceForPath } from "@/components/layout/nav";
import { ComposeEmailButton } from "@/components/pm/ComposeEmailButton";

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
