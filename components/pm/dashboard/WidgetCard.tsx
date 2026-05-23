"use client";

// Shared chrome for every Dashboard widget (PROPERTY_TODO.md Phase 10).
// Card title + optional tab strip + content slot + footer + View all → link.
//
// The `View all →` builder is the **G-B-12 hook**: widgets pass their current
// tab/window via `viewAllParams` and the helper appends matching query params
// to the deep-link target. The receiving list page reads those params with
// `useSearchParams` and pre-applies its filter.
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

export interface WidgetCardProps {
  title: string;
  /** Pre-rendered tab strip (the widget owns its TabsList). Null for tab-less widgets. */
  tabs?: React.ReactNode;
  /** Deep-link to the widget's full list page. */
  viewAllHref?: string;
  /** Appended to `viewAllHref` as `?key=value` so the target pre-applies the filter (G-B-12). */
  viewAllParams?: Record<string, string | number | null | undefined>;
  /** Footer text — usually "Showing N of M" or a date range hint. */
  footer?: React.ReactNode;
  /** Trailing controls in the header (e.g. date range dropdown). */
  headerExtra?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

function buildHref(
  base: string,
  params?: Record<string, string | number | null | undefined>,
): string {
  if (!params) return base;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  if (!s) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${s}`;
}

export function WidgetCard({
  title,
  tabs,
  viewAllHref,
  viewAllParams,
  footer,
  headerExtra,
  className,
  contentClassName,
  children,
}: WidgetCardProps) {
  const href = viewAllHref ? buildHref(viewAllHref, viewAllParams) : null;
  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="flex-col items-start gap-3 sm:flex-row sm:items-center">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-2">
          {tabs}
          {headerExtra}
        </div>
      </CardHeader>
      <CardContent
        className={cn("flex flex-1 flex-col gap-3", contentClassName)}
      >
        {children}
      </CardContent>
      {(href || footer) && (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-fg-muted">
          <span className="truncate">{footer}</span>
          {href && (
            <Link
              href={href}
              className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary transition-colors hover:text-primary-container"
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

export default WidgetCard;
