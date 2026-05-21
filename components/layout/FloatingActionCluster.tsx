"use client";

// Fixed bottom-right floating action cluster for the PM workspace. Hosts the
// persistent Compose-email button (BR-CC-1). Hidden in the Stocks workspace
// since none of these affordances apply there.
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
