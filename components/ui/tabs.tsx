"use client";

// Accessible tabs. Lattice design uses an underline pattern (bottom border on
// the active tab, no chip background) which is now the default. The original
// segmented "pill" look is still available via `variant="segmented"` on the
// list — kept for callers that prefer the legacy treatment.
import * as React from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "underline" | "segmented";

interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
  variant: Variant;
}
const Ctx = React.createContext<TabsCtx | null>(null);

function useTabs(): TabsCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("Tabs components must be used within <Tabs>");
  return ctx;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
  variant = "underline",
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: React.ReactNode;
  variant?: Variant;
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const current = value ?? internal;
  const setValue = React.useCallback(
    (v: string) => {
      if (value === undefined) setInternal(v);
      onValueChange?.(v);
    },
    [value, onValueChange],
  );
  return (
    <Ctx.Provider value={{ value: current, setValue, variant }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { variant } = useTabs();
  if (variant === "segmented") {
    return (
      <div
        role="tablist"
        className={cn(
          "inline-flex gap-0.5 rounded-md border border-border bg-surface p-[2px]",
          className,
        )}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      role="tablist"
      className={cn(
        "mb-4 flex gap-0 border-b border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: active, setValue, variant } = useTabs();
  const selected = active === value;
  if (variant === "segmented") {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => setValue(value)}
        className={cn(
          "rounded px-3 py-1 text-[11px] font-semibold transition-colors",
          selected
            ? "bg-secondary-container text-primary"
            : "text-fg-muted hover:text-fg",
          className,
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => setValue(value)}
      className={cn(
        "-mb-px flex items-center gap-[7px] border-b-2 px-[14px] py-[9px] text-[12.5px] font-medium transition-colors",
        selected
          ? "border-primary font-semibold text-fg"
          : "border-transparent text-fg-muted hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: active } = useTabs();
  if (active !== value) return null;
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}
