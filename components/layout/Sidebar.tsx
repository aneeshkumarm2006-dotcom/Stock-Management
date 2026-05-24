"use client";

// Fixed desktop sidebar (≥ md). Lattice design layout: 232px-wide rail with
// a brand block (workspace switcher), a static "Quick find" affordance, the
// workspace-specific nav tree grouped by section, and a user footer.
// The active workspace is derived from the URL (PDR §1.4, §4.1).
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { MoreHorizontal } from "lucide-react";
import {
  getNavForWorkspace,
  getWorkspaceForPath,
  isActivePath,
  isNavGroup,
  type NavItem,
  type NavNode,
} from "./nav";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils/cn";

/**
 * Splits the flat nav list (a mix of leaves and groups) into the design's
 * grouped layout: top-level leaves become an unnamed group at the top, each
 * `NavGroup` becomes a titled section, and any trailing leaves (e.g. a final
 * "Settings") become their own untitled tail group.
 */
function sectionize(
  nodes: readonly NavNode[],
): Array<{ title: string | null; items: NavItem[] }> {
  const sections: Array<{ title: string | null; items: NavItem[] }> = [];
  let leading: NavItem[] = [];
  for (const node of nodes) {
    if (isNavGroup(node)) {
      if (leading.length) {
        sections.push({ title: null, items: leading });
        leading = [];
      }
      sections.push({ title: node.label, items: node.children });
    } else {
      leading.push(node);
    }
  }
  if (leading.length) sections.push({ title: null, items: leading });
  return sections;
}

export function Sidebar() {
  const pathname = usePathname();
  const workspace = getWorkspaceForPath(pathname);
  const nav = getNavForWorkspace(workspace);
  const sections = React.useMemo(() => sectionize(nav), [nav]);
  const { data: session } = useSession();
  const user = session?.user;
  const userInitial = (user?.name ?? user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <aside className="fixed left-0 top-0 z-50 hidden h-screen w-[232px] flex-col border-r border-border bg-surface-high md:flex">
      {/* Brand block — clicking opens the workspace switcher. */}
      <div className="border-b border-border px-[14px] pb-3 pt-[14px]">
        <WorkspaceSwitcher />
      </div>

      {/* Grouped nav. */}
      <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {sections.map((section, i) => (
          <div key={section.title ?? `untitled-${i}`} className="mt-[10px]">
            {section.title && (
              <div className="px-[10px] pb-1 pt-[6px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
                {section.title}
              </div>
            )}
            {section.items.map((item) => (
              <SidebarItem
                key={item.href}
                item={item}
                pathname={pathname}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* User footer. */}
      <div className="flex items-center gap-[9px] border-t border-border px-3 py-[10px]">
        <Dropdown
          align="start"
          trigger={
            <span className="grid h-[26px] w-[26px] place-items-center overflow-hidden rounded-full bg-gradient-to-br from-tertiary to-tertiary-container text-[11px] font-semibold text-tertiary-fg">
              {user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Google avatar; next/image not worth the loader config here
                <img
                  src={user.image}
                  alt={user?.name ?? "Account"}
                  className="h-full w-full object-cover"
                />
              ) : (
                userInitial
              )}
            </span>
          }
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-semibold text-fg">
              {user?.name ?? "Account"}
            </p>
            {user?.email && (
              <p className="truncate text-xs text-fg-muted">{user.email}</p>
            )}
          </div>
          <Link href="/settings">
            <DropdownItem>Settings</DropdownItem>
          </Link>
          <DropdownItem
            className="text-error hover:text-error"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            Logout
          </DropdownItem>
        </Dropdown>
        <div className="min-w-0 flex-1 leading-[1.25]">
          <div className="truncate text-[12px] font-semibold text-fg">
            {user?.name ?? "Account"}
          </div>
          {user?.email && (
            <div className="truncate text-[10.5px] text-fg-muted">
              {user.email}
            </div>
          )}
        </div>
        <MoreHorizontal className="h-3.5 w-3.5 text-fg-muted" />
      </div>
    </aside>
  );
}

function SidebarItem({
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
        className="my-[1px] flex cursor-not-allowed items-center gap-[9px] whitespace-nowrap rounded-[5px] px-[10px] py-[5px] text-[12.5px] font-medium text-fg-muted opacity-50"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{item.label}</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "my-[1px] flex items-center gap-[9px] whitespace-nowrap rounded-[5px] px-[10px] py-[5px] text-[12.5px] font-medium transition-colors",
        active
          ? "bg-secondary-container font-semibold text-primary"
          : "text-fg-muted hover:bg-surface-lowest hover:text-fg",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

