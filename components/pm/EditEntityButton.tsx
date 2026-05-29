"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface Props {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  /** "row" renders a borderless pencil icon for in-table use; "header"
   *  renders a labelled outline button for detail-page headers. */
  variant?: "row" | "header";
  className?: string;
}

export function EditEntityButton({
  onClick,
  disabled,
  label = "Edit",
  variant = "row",
  className,
}: Props) {
  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "rounded p-1 text-fg-muted hover:bg-surface-high hover:text-fg disabled:cursor-not-allowed disabled:opacity-30",
          className,
        )}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      <Pencil className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}
