"use client";

// Shared slide-in side panel chrome (PDR §5.1, §5.3 — Add / Edit Position).
// Right-anchored sheet: backdrop + Framer Motion slide, Esc to close, body
// scroll-lock, portalled above everything. The panel chrome / vocabulary is
// the one established in the site/design/portfolio reference (Stage 1 scope:
// no separate panel mockup — built to the "Portfolio Dark" design system).
import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// STATE-008: multiple SidePanels can be open at once (e.g. an edit panel that
// opens a nested confirm sheet). A per-instance save/restore of
// document.body.style.overflow corrupts the stack: the second panel saves the
// already-"hidden" value, so when it closes it restores "hidden" and leaves the
// page scroll-locked. A module-level open counter fixes this: we snapshot the
// ORIGINAL overflow only on the 0→1 transition and restore it only on 1→0.
let bodyLockCount = 0;
let originalBodyOverflow = "";

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
}

function unlockBodyScroll() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    document.body.style.overflow = originalBodyOverflow;
  }
}

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Sticky footer (action buttons). */
  footer?: React.ReactNode;
}

export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: SidePanelProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // STATE-008: ref-counted lock instead of a per-instance save/restore.
    lockBodyScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockBodyScroll();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110]">
          <motion.div
            className="absolute inset-0 bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              "absolute right-0 top-0 flex h-full w-full max-w-md flex-col",
              "border-l border-border bg-surface-high shadow-2xl",
            )}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="font-display text-base font-bold text-fg">
                  {title}
                </h2>
                {description && (
                  <p className="mt-1 text-xs text-fg-muted">{description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="text-fg-muted transition-colors hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">{children}</div>

            {footer && (
              <div className="border-t border-border p-5">{footer}</div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
