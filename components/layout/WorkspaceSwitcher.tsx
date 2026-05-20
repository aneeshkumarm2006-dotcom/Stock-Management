"use client";

// Top-of-sidebar switcher that toggles between the Stocks workspace and the
// Property Management workspace (PDR §1.4). The active workspace is derived
// from the URL — picking the other workspace just navigates to its landing
// route, which causes the sidebar to re-render with that workspace's nav tree.
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, Check } from "lucide-react";
import { WORKSPACES, getWorkspaceForPath, type Workspace } from "./nav";
import { cn } from "@/lib/utils/cn";

export function WorkspaceSwitcher() {
  const pathname = usePathname();
  const activeId = getWorkspaceForPath(pathname);
  // WORKSPACES is non-empty at compile time, so the fallback is just for the
  // type checker under noUncheckedIndexedAccess — never observable at runtime.
  const active =
    WORKSPACES.find((w) => w.id === activeId) ?? (WORKSPACES[0] as Workspace);

  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ActiveIcon = active.icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-high"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <ActiveIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex min-w-0 flex-col">
            <span className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
              Workspace
            </span>
            <span className="truncate text-sm font-semibold text-fg">
              {active.label}
            </span>
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-fg-muted" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-surface-high py-1 shadow-lg animate-fade-in"
        >
          {WORKSPACES.map((ws) => {
            const Icon = ws.icon;
            const isActive = ws.id === activeId;
            return (
              <Link
                key={ws.id}
                href={ws.landing}
                role="option"
                aria-selected={isActive}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-surface-highest",
                  isActive ? "text-primary" : "text-fg",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate font-medium">{ws.label}</span>
                {isActive && <Check className="h-4 w-4 shrink-0" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
