"use client";

// Fixed desktop sidebar (≥ md). Mirrors the chrome in the saved Stitch
// dashboard/portfolio references: brand block, primary nav with active
// accent, footer with Support + Logout. Hidden < md (MobileTabBar takes over).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { HelpCircle, LogOut } from "lucide-react";
import { NAV_ITEMS, isActivePath } from "./nav";
import { cn } from "@/lib/utils/cn";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Portfolio";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-50 hidden h-screen w-64 flex-col border-r border-border bg-surface-low px-4 py-6 md:flex">
      <div className="mb-10 px-2">
        <h1 className="font-display text-xl font-bold tracking-tight text-fg">
          {APP_NAME}
        </h1>
        <p className="text-xs text-fg-muted opacity-70">Personal account</p>
      </div>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-r-2 border-primary bg-secondary-container/30 font-bold text-primary"
                  : "text-fg-muted hover:bg-surface-high hover:text-fg",
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
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
