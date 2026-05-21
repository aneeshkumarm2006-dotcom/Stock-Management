"use client";

// Client-side wrapper around the dashboard content. Adjusts the left padding
// when the sidebar collapses so the page reflows in lockstep with the rail.
import * as React from "react";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils/cn";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  return (
    <div
      className={cn(
        "flex min-h-screen flex-col transition-[padding] duration-150",
        collapsed ? "md:pl-16" : "md:pl-64",
      )}
    >
      {children}
    </div>
  );
}

export default DashboardShell;
