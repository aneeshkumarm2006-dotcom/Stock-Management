// shadcn-style Button, copied into the repo (not a runtime dep) per
// Tech_Stack.md §Component primitives. Sizing and spacing now match the
// Lattice design: 30px default height, 26px small, 6px radius, 12.5px label.
import * as React from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-fg border border-primary hover:bg-primary-container hover:border-primary-container disabled:opacity-50",
  secondary:
    "bg-surface text-fg border border-border hover:bg-surface-lowest hover:border-outline disabled:opacity-50",
  outline:
    "border border-border bg-transparent text-fg hover:bg-surface-lowest disabled:opacity-50",
  ghost:
    "border border-transparent bg-transparent text-fg-muted hover:bg-surface-lowest hover:text-fg",
  destructive:
    "bg-error text-white border border-error hover:bg-error/90 disabled:opacity-50",
};

const SIZE: Record<Size, string> = {
  sm: "h-[26px] px-[9px] text-[11.5px]",
  md: "h-[30px] px-[11px] text-[12.5px]",
  lg: "h-[36px] px-4 text-[13px]",
  icon: "h-[30px] w-[30px] p-0",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-[6px] whitespace-nowrap rounded-md font-medium tracking-[-0.005em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
