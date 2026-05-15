// shadcn-style Button, copied into the repo (not a runtime dep) per
// Tech_Stack.md §Component primitives. Variants implemented locally without
// cva to avoid an extra dependency.
import * as React from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-fg hover:bg-primary-container disabled:opacity-50",
  secondary:
    "bg-surface-highest text-fg hover:bg-surface-high border border-border disabled:opacity-50",
  outline:
    "border border-border bg-transparent text-fg hover:bg-surface-high disabled:opacity-50",
  ghost: "bg-transparent text-fg-muted hover:bg-surface-high hover:text-fg",
  destructive:
    "bg-error text-white hover:bg-error/90 disabled:opacity-50",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-6 text-sm",
  icon: "h-9 w-9 p-0",
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
        "inline-flex items-center justify-center gap-2 rounded font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
