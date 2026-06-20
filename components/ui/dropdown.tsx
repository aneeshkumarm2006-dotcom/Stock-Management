"use client";

// Lightweight dropdown menu (click to toggle, outside-click + Esc to close).
// Used by the TopBar account menu and table row actions.
// The menu is portaled to document.body with fixed positioning so it can't be
// clipped by an `overflow-hidden` ancestor (e.g. our Card component).
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
  /** Extra classes for the trigger button (e.g. "w-full" for a full-row trigger). */
  triggerClassName?: string;
  /** Fired whenever the open state changes (e.g. to mark notifications read). */
  onOpenChange?: (open: boolean) => void;
}

const MENU_MIN_WIDTH = 160; // matches min-w-[10rem]
const GAP = 8; // mt-2 spacing between trigger and menu

export function Dropdown({
  trigger,
  children,
  align = "end",
  className,
  triggerClassName,
  onOpenChange,
}: DropdownProps) {
  const [open, setOpenState] = React.useState(false);
  // Keep onOpenChange in a ref so setOpen stays referentially stable.
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setOpen = React.useCallback(
    (next: boolean | ((o: boolean) => boolean)) => {
      setOpenState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        if (value !== prev) onOpenChangeRef.current?.(value);
        return value;
      });
    },
    [],
  );
  const [mounted, setMounted] = React.useState(false);
  const [coords, setCoords] = React.useState<{
    top: number;
    left: number;
    placement: "below" | "above";
  } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const menuWidth = Math.max(menuRef.current?.offsetWidth ?? 0, MENU_MIN_WIDTH);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Flip above when there's not enough room below and more room above.
    const placement: "below" | "above" =
      menuHeight > 0 && spaceBelow < menuHeight + GAP && spaceAbove > spaceBelow
        ? "above"
        : "below";
    const top =
      placement === "below" ? rect.bottom + GAP : rect.top - menuHeight - GAP;
    let left = align === "end" ? rect.right - menuWidth : rect.left;
    // Keep within viewport horizontally.
    const maxLeft = window.innerWidth - menuWidth - 4;
    if (left > maxLeft) left = maxLeft;
    if (left < 4) left = 4;
    setCoords({ top, left, placement });
  }, [align]);

  React.useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => updatePosition();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex items-center", triggerClassName)}
      >
        {trigger}
      </button>
      {open && mounted &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              visibility: coords ? "visible" : "hidden",
            }}
            className={cn(
              "z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-surface-high py-1 animate-fade-in",
              className,
            )}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

export function DropdownItem({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-surface-highest hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}
