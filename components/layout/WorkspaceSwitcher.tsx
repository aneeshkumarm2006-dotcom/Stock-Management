"use client";

// Top-of-sidebar workspace identity block (Lattice design). Renders the brand
// glyph + product name + active-workspace subtitle. Clicking opens a dropdown
// to switch between Stocks and Property Management — picking the other
// workspace navigates to its landing route, which causes the sidebar to
// re-render with that workspace's nav tree (PDR §1.4).
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import { WORKSPACES, getWorkspaceForPath, type Workspace } from "./nav";
import { cn } from "@/lib/utils/cn";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Portfolio";

export function WorkspaceSwitcher() {
  const pathname = usePathname();
  const activeId = getWorkspaceForPath(pathname);
  const active =
    WORKSPACES.find((w) => w.id === activeId) ?? (WORKSPACES[0] as Workspace);

  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  // STATE-014: keep a handle on the trigger so focus returns to it when the
  // listbox closes (Escape / outside click / option pick).
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listboxRef = React.useRef<HTMLDivElement>(null);

  // STATE-014: close + return focus to the trigger in one place so every
  // dismissal path is keyboard-accessible.
  const close = React.useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Outside click: don't yank focus back to the trigger.
        close(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // STATE-014: move focus into the listbox when it opens so Tab is trapped
  // within it (and so screen-reader/keyboard users land on the options).
  React.useEffect(() => {
    if (!open) return;
    const first = listboxRef.current?.querySelector<HTMLElement>(
      '[role="option"]',
    );
    first?.focus();
  }, [open]);

  // STATE-014: simple Tab trap — keep focus cycling among the options while the
  // listbox is open instead of escaping to the rest of the page (no library).
  const onListboxKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const options = Array.from(
        listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ??
          [],
      );
      const first = options[0];
      const last = options[options.length - 1];
      if (!first || !last) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [close],
  );

  const initial = APP_NAME.charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-[9px] px-1 py-0 text-left transition-colors"
      >
        <span
          aria-hidden
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary-container text-[12px] font-bold tracking-tight text-primary-fg"
        >
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13.5px] font-semibold tracking-tight text-fg">
            {APP_NAME}
          </span>
          <span className="truncate text-[10.5px] font-medium text-fg-muted">
            {active.label}
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
      </button>

      {open && (
        <div
          ref={listboxRef}
          role="listbox"
          aria-label="Switch workspace"
          tabIndex={-1}
          onKeyDown={onListboxKeyDown}
          className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg animate-fade-in"
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
                onClick={() => close(false)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-[12.5px] transition-colors hover:bg-surface-lowest",
                  isActive ? "text-primary font-semibold" : "text-fg",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate font-medium">{ws.label}</span>
                {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
