// Pill-style badge matching the Lattice design: 20px tall, 7px horizontal
// padding, 4px radius, 11px / semibold label. Each tonal variant pairs a soft
// background tint with the matching saturated text color.
import * as React from "react";
import { cn } from "@/lib/utils/cn";

type BadgeVariant =
  | "default"
  | "outline"
  | "gain"
  | "loss"
  | "exchange"
  | "muted"
  | "brand"
  | "green"
  | "red"
  | "amber"
  | "blue"
  | "purple"
  | "slate";

const VARIANT: Record<BadgeVariant, string> = {
  default: "bg-surface-highest text-fg",
  outline: "border border-border bg-transparent text-fg-muted",
  muted: "bg-surface-highest text-fg-muted",
  brand: "bg-secondary-container text-primary",
  // Stocks-specific aliases for gain/loss (preserves existing call sites).
  gain: "bg-gain/15 text-gain",
  loss: "bg-loss/15 text-loss",
  exchange:
    "border border-border bg-surface-low text-fg-muted uppercase tracking-[0.04em]",
  // Tonal palette mirroring the design's status colors.
  green: "bg-gain/15 text-gain",
  red: "bg-loss/15 text-loss",
  amber: "bg-tertiary-container text-tertiary",
  blue: "bg-secondary-container text-primary",
  purple: "bg-secondary-container text-primary",
  slate: "bg-surface-highest text-fg-muted",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-[5px] whitespace-nowrap rounded-sm px-[7px] text-[11px] font-semibold",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}
