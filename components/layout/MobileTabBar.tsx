"use client";

// Bottom tab bar that replaces the sidebar < 768px. Workspace-aware: flattens
// the active workspace's nav tree to its top-level entries (groups collapse to
// their first child), and adds a switcher chip for jumping to the other
// workspace (PDR §1.4).
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  WORKSPACES,
  flatTopLevel,
  getNavForWorkspace,
  getWorkspaceForPath,
  isActivePath,
} from "./nav";
import { cn } from "@/lib/utils/cn";

export function MobileTabBar() {
  const pathname = usePathname();
  const workspace = getWorkspaceForPath(pathname);
  const items = flatTopLevel(getNavForWorkspace(workspace));
  const other = WORKSPACES.find((w) => w.id !== workspace);

  return (
    <nav className="fixed bottom-0 left-0 z-50 flex h-16 w-full items-stretch border-t border-border bg-surface-high md:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-fg-muted",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
      {other && (
        <Link
          href={other.landing}
          aria-label={`Switch to ${other.label}`}
          className="flex flex-1 flex-col items-center justify-center gap-1 border-l border-border text-[10px] font-medium text-fg-muted transition-colors hover:text-fg"
        >
          <other.icon className="h-5 w-5" />
          {other.label.split(" ")[0]}
        </Link>
      )}
    </nav>
  );
}
