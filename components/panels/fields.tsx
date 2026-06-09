"use client";

// Small form-field helpers shared by the Add / Edit position panels so the
// two stay visually identical (labelled control + inline error). Built on the
// Stage 6 Input/Label primitives + the "Portfolio Dark" tokens.
import * as React from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[11px] font-medium text-error">{message}</p>;
}

export const Field = React.forwardRef<
  HTMLInputElement,
  InputProps & { label: string; error?: string }
>(({ label, error, id, ...props }, ref) => (
  <div>
    <Label htmlFor={id} className="mb-1.5 block">
      {label}
    </Label>
    <Input
      ref={ref}
      id={id}
      aria-invalid={error ? true : undefined}
      {...props}
    />
    <FieldError message={error} />
  </div>
));
Field.displayName = "Field";

export const SelectField = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    label: string;
    error?: string;
  }
>(({ label, error, id, className, children, ...props }, ref) => (
  <div>
    <Label htmlFor={id} className="mb-1.5 block">
      {label}
    </Label>
    <select
      ref={ref}
      id={id}
      aria-invalid={error ? true : undefined}
      className={cn(
        "flex h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg transition-colors",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
        "aria-[invalid=true]:border-error",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <FieldError message={error} />
  </div>
));
SelectField.displayName = "SelectField";
