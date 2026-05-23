"use client";

// Dashboard widget grid (PROPERTY_TODO.md Phase 10). Fetches the caller's
// layout via /api/pm/dashboard-layout, resolves each layout entry to a
// component via the registry, and renders the enabled set in order.
//
// Layout state lives in this client component so the Customize modal can
// update it optimistically and re-render the grid without a round-trip.
import * as React from "react";
import { DashboardHeader } from "./DashboardHeader";
import { WidgetSkeleton } from "./WidgetSkeleton";
import {
  WIDGET_COMPONENTS,
  WIDGET_WIDE_ON_XL,
} from "./widgets/registry";
import {
  DASHBOARD_WIDGETS,
  reconcileLayout,
} from "@/lib/pm/dashboardWidgets";
import { cn } from "@/lib/utils/cn";

export interface LayoutItem {
  widgetId: string;
  enabled: boolean;
  order: number;
}

interface LayoutPayload {
  items: LayoutItem[];
}

const TITLE_BY_ID = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w.title]));

export function DashboardGrid() {
  const [layout, setLayout] = React.useState<LayoutItem[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/dashboard-layout")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LayoutPayload | null) => {
        if (cancelled) return;
        setLayout(reconcileLayout(d?.items ?? []));
      })
      .catch(() => {
        if (!cancelled) setLayout(reconcileLayout([]));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onLayoutSaved = React.useCallback((next: LayoutItem[]) => {
    setLayout(reconcileLayout(next));
  }, []);

  // Skeleton state — render the default layout's enabled widgets as skeletons
  // so the grid takes shape before /dashboard-layout resolves.
  if (layout == null) {
    return (
      <div>
        <DashboardHeader layout={null} onSaved={onLayoutSaved} />
        <DashboardSkeletonGrid />
      </div>
    );
  }

  const enabled = layout
    .filter((i) => i.enabled)
    .sort((a, b) => a.order - b.order);

  return (
    <div>
      <DashboardHeader layout={layout} onSaved={onLayoutSaved} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {enabled.map((item) => {
          const Comp = WIDGET_COMPONENTS[item.widgetId];
          if (!Comp) return null;
          const wide = WIDGET_WIDE_ON_XL.has(item.widgetId);
          return (
            <div
              key={item.widgetId}
              className={cn(wide && "xl:col-span-2")}
            >
              <Comp />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardSkeletonGrid() {
  // Use the registry's default order so the skeleton matches what users
  // typically see (before any customization).
  const ordered = DASHBOARD_WIDGETS.slice().sort(
    (a, b) => a.defaultOrder - b.defaultOrder,
  );
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {ordered.map((w) => (
        <div
          key={w.id}
          className={cn(WIDGET_WIDE_ON_XL.has(w.id) && "xl:col-span-2")}
        >
          <WidgetSkeleton title={TITLE_BY_ID.get(w.id) ?? w.title} />
        </div>
      ))}
    </div>
  );
}

export default DashboardGrid;
