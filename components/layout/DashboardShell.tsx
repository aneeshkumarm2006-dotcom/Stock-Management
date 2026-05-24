"use client";

// Client-side wrapper around the dashboard content. Lattice design uses a
// fixed 232px sidebar with no collapse, so we just offset the main column to
// match (≥ md). On mobile the sidebar is hidden and the bottom MobileTabBar
// takes over, so no left padding is applied.
import * as React from "react";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:pl-[232px]">{children}</div>
  );
}

export default DashboardShell;
