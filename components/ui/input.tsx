import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded border border-border bg-surface-highest px-3 py-2 text-sm text-fg placeholder:text-fg-muted/60 transition-colors",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
