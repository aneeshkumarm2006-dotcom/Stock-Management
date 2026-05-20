"use client";

// Fixed desktop sidebar (≥ md). Renders the nav tree for the active workspace
// (PDR §1.4, §4.1): Stocks gets a flat list; Property Management gets nested
// Rentals/Leasing groups plus disabled future modules.
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { HelpCircle, LogOut, ChevronDown } from "lucide-react";
import {
  getNavForWorkspace,
  getWorkspaceForPath,
  isActiveGroup,
  isActivePath,
  isNavGroup,
  type NavGroup,
  type NavItem,
} from "./nav";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { cn } from "@/lib/utils/cn";

export function Sidebar() {
  const pathname = usePathname();
  const workspace = getWorkspaceForPath(pathname);
  const nav = getNavForWorkspace(workspace);

  return (
    <aside className="fixed left-0 top-0 z-50 hidden h-screen w-64 flex-col border-r border-border bg-surface-low px-4 py-6 md:flex">
      <div className="mb-6">
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
        {nav.map((node) =>
          isNavGroup(node) ? (
            <SidebarGroup key={node.id} group={node} pathname={pathname} />
          ) : (
            <SidebarLeaf key={node.href} item={node} pathname={pathname} />
          ),
        )}
      </nav>

      <div className="mt-auto space-y-1 border-t border-border pt-4">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-high hover:text-fg"
        >
          <HelpCircle className="h-5 w-5" />
          Support
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-sm font-medium text-error transition-colors hover:bg-surface-high"
        >
          <LogOut className="h-5 w-5" />
          Logout
        </button>
      </div>
    </aside>
  );
}

function SidebarLeaf({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) {
  const Icon = item.icon;
  const active = !item.disabled && isActivePath(pathname, item.href);

  if (item.disabled) {
    return (
      <span
        aria-disabled="true"
        title="Coming soon"
        className="flex cursor-not-allowed items-center gap-3 rounded px-3 py-2.5 text-sm font-medium text-fg-muted opacity-50"
      >
        <Icon className="h-5 w-5" />
        {item.label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-r-2 border-primary bg-secondary-container/30 font-bold text-primary"
          : "text-fg-muted hover:bg-surface-high hover:text-fg",
      )}
    >
      <Icon className="h-5 w-5" />
      {item.label}
    </Link>
  );
}

function SidebarGroup({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const activeChild = isActiveGroup(pathname, group);
  // Groups auto-open when one of their children is active; the user can still
  // collapse them, but if they navigate into a child it re-opens.
  const [open, setOpen] = React.useState(activeChild);
  React.useEffect(() => {
    if (activeChild) setOpen(true);
  }, [activeChild]);

  const Icon = group.icon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
          activeChild
            ? "text-fg"
            : "text-fg-muted hover:bg-surface-high hover:text-fg",
        )}
      >
        <Icon className="h-5 w-5" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="ml-3 mt-1 space-y-0.5 border-l border-border pl-3">
          {group.children.map((child) => {
            const ChildIcon = child.icon;
            const active = isActivePath(pathname, child.href);
            return (
              <Link
                key={child.href}
                href={child.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] transition-colors",
                  active
                    ? "bg-secondary-container/30 font-semibold text-primary"
                    : "text-fg-muted hover:bg-surface-high hover:text-fg",
                )}
              >
                <ChildIcon className="h-4 w-4" />
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
