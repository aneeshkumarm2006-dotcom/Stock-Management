"use client";

// Fixed desktop sidebar (≥ md). Renders the nav tree for the active workspace
// (PDR §1.4, §4.1): Stocks gets a flat list; Property Management gets nested
// Rentals/Leasing groups plus disabled future modules.
// Collapse: when collapsed, the sidebar shrinks to a 64px icon rail. The
// preference is persisted per-user via useUiStore (DECISIONS.md [G-B-11]).
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  HelpCircle,
  LogOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
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
import { useUiStore } from "@/store/useUiStore";

export function Sidebar() {
  const pathname = usePathname();
  const workspace = getWorkspaceForPath(pathname);
  const nav = getNavForWorkspace(workspace);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebarCollapsed);

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "fixed left-0 top-0 z-50 hidden h-screen flex-col border-r border-border bg-surface-low py-6 transition-[width] duration-150 md:flex",
        collapsed ? "w-16 px-2" : "w-64 px-4",
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher />
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-high hover:text-fg",
            collapsed && "mx-auto",
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
        {nav.map((node) =>
          isNavGroup(node) ? (
            <SidebarGroup
              key={node.id}
              group={node}
              pathname={pathname}
              collapsed={collapsed}
            />
          ) : (
            <SidebarLeaf
              key={node.href}
              item={node}
              pathname={pathname}
              collapsed={collapsed}
            />
          ),
        )}
      </nav>

      <div className="mt-auto space-y-1 border-t border-border pt-4">
        <Link
          href="/settings"
          title="Support"
          className={cn(
            "flex items-center gap-3 rounded text-sm font-medium text-fg-muted transition-colors hover:bg-surface-high hover:text-fg",
            collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
          )}
        >
          <HelpCircle className="h-5 w-5" />
          {!collapsed && <span>Support</span>}
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Logout"
          className={cn(
            "flex w-full items-center gap-3 rounded text-sm font-medium text-error transition-colors hover:bg-surface-high",
            collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
          )}
        >
          <LogOut className="h-5 w-5" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}

function SidebarLeaf({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const active = !item.disabled && isActivePath(pathname, item.href);

  if (item.disabled) {
    return (
      <span
        aria-disabled="true"
        title={collapsed ? `${item.label} (coming soon)` : "Coming soon"}
        className={cn(
          "flex cursor-not-allowed items-center gap-3 rounded text-sm font-medium text-fg-muted opacity-50",
          collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
        )}
      >
        <Icon className="h-5 w-5" />
        {!collapsed && <span>{item.label}</span>}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-3 rounded text-sm font-medium transition-colors",
        collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
        active
          ? "border-r-2 border-primary bg-secondary-container/30 font-bold text-primary"
          : "text-fg-muted hover:bg-surface-high hover:text-fg",
      )}
    >
      <Icon className="h-5 w-5" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function SidebarGroup({
  group,
  pathname,
  collapsed,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
}) {
  const activeChild = isActiveGroup(pathname, group);
  // Groups auto-open when one of their children is active; the user can still
  // collapse them, but if they navigate into a child it re-opens.
  const [open, setOpen] = React.useState(activeChild);
  React.useEffect(() => {
    if (activeChild) setOpen(true);
  }, [activeChild]);

  const Icon = group.icon;

  // In collapsed mode, render the group as a compact icon that links to the
  // first child instead of expanding inline (saves vertical space).
  if (collapsed) {
    const firstChild = group.children[0];
    if (!firstChild) return null;
    const ChildIcon = group.icon;
    return (
      <Link
        href={firstChild.href}
        title={group.label}
        className={cn(
          "flex items-center justify-center rounded px-2 py-2.5 text-sm transition-colors",
          activeChild
            ? "text-primary"
            : "text-fg-muted hover:bg-surface-high hover:text-fg",
        )}
      >
        <ChildIcon className="h-5 w-5" />
      </Link>
    );
  }

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
