import * as React from "react";
import { cn } from "@/lib/utils/cn";

type BadgeVariant =
  | "default"
  | "outline"
  | "gain"
  | "loss"
  | "exchange"
  | "muted";

const VARIANT: Record<BadgeVariant, string> = {
  default: "bg-secondary-container text-fg",
  outline: "border border-border bg-surface text-fg-muted",
  gain: "bg-gain/15 text-gain",
  loss: "bg-loss/15 text-loss",
  exchange:
    "border border-border bg-surface-low text-fg-muted uppercase tracking-wider",
  muted: "bg-surface-highest text-fg-muted",
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
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
        "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}
