// Text input matching the Lattice design's `.search` / form field metrics:
// 30px tall, 6px radius, 12px label, white-surface background with hairline
// border. Focus ring uses the brand blue.
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const BLOCKED_NUMBER_KEYS = new Set(["-", "+", "e", "E"]);

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", onKeyDown, ...props }, ref) => {
    const handleKeyDown =
      type === "number"
        ? (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (BLOCKED_NUMBER_KEYS.has(e.key)) e.preventDefault();
            onKeyDown?.(e);
          }
        : onKeyDown;
    return (
      <input
        ref={ref}
        type={type}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-[30px] w-full rounded-md border border-border bg-surface px-[10px] text-[12px] text-fg placeholder:text-fg-muted/70 transition-colors",
          "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
