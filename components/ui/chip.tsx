"use client";

// Filter chip from the Lattice design — 26px pill with a hairline border.
// The active state inverts to the fg color (dark pill, light text), matching
// the design's `.chip.active` treatment. An optional `count` renders a small
// counter badge at the right.
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number | null;
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, active, count, children, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-pressed={active}
      className={cn(
        "inline-flex h-[26px] items-center gap-[5px] whitespace-nowrap rounded-full border px-[10px] text-[11.5px] font-medium transition-colors",
        active
          ? "border-fg bg-fg text-bg"
          : "border-border bg-surface text-fg-muted hover:bg-surface-lowest hover:text-fg",
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {count != null && (
        <span
          className={cn(
            "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold",
            active
              ? "bg-bg/20 text-bg/85"
              : "bg-surface-highest text-fg-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  ),
);
Chip.displayName = "Chip";
