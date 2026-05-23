// Single source of truth for PM Dashboard widget IDs + default layout.
// Imported by both the /api/pm/dashboard-layout route (server) and the
// widgets/registry.tsx mapping (client). Adding a new widget = adding one
// entry here; the route will allow the new ID through validation and the
// next GET will seed it for users whose stored layout doesn't yet include it.
//
// `defaultOrder` controls the canonical 3x3 grid; `defaultEnabled` lets us
// ship a widget hidden-by-default if needed (none today).

export interface DashboardWidgetMeta {
  id: string;
  title: string;
  defaultEnabled: boolean;
  defaultOrder: number;
}

export const DASHBOARD_WIDGETS: readonly DashboardWidgetMeta[] = [
  { id: 'outstandingBalances',     title: 'Outstanding Balances',       defaultEnabled: true, defaultOrder: 0 },
  { id: 'tasks',                   title: 'Tasks',                      defaultEnabled: true, defaultOrder: 1 },
  { id: 'rentersInsurance',        title: 'Renters Insurance',          defaultEnabled: true, defaultOrder: 2 },
  { id: 'overdueTasks',            title: 'Overdue Tasks',              defaultEnabled: true, defaultOrder: 3 },
  { id: 'expiringLeases',          title: 'Expiring Leases',            defaultEnabled: true, defaultOrder: 4 },
  { id: 'expiringRentersInsurance', title: 'Expiring Renters Insurance', defaultEnabled: true, defaultOrder: 5 },
  { id: 'rentalListings',          title: 'Rental Listings',            defaultEnabled: true, defaultOrder: 6 },
  { id: 'rentalApplications',      title: 'Rental Applications',        defaultEnabled: true, defaultOrder: 7 },
  { id: 'recentActivity',          title: 'Recent Activity',            defaultEnabled: true, defaultOrder: 8 },
  { id: 'bankFeed',                title: 'Bank Feed',                  defaultEnabled: true, defaultOrder: 9 },
] as const;

export const DASHBOARD_WIDGET_IDS: ReadonlySet<string> = new Set(
  DASHBOARD_WIDGETS.map((w) => w.id),
);

export function defaultDashboardLayout(): Array<{
  widgetId: string;
  enabled: boolean;
  order: number;
}> {
  return DASHBOARD_WIDGETS.map((w) => ({
    widgetId: w.id,
    enabled: w.defaultEnabled,
    order: w.defaultOrder,
  }));
}

/**
 * Merge any items missing from a user's stored layout. Returns a new array
 * containing every registry widget exactly once, preserving user order/enabled
 * for known IDs and appending newly-registered widgets at the end.
 */
export function reconcileLayout(
  stored: Array<{ widgetId: string; enabled: boolean; order: number }>,
): Array<{ widgetId: string; enabled: boolean; order: number }> {
  const byId = new Map(stored.map((s) => [s.widgetId, s]));
  const known: Array<{ widgetId: string; enabled: boolean; order: number }> = [];
  const seen = new Set<string>();

  // Known IDs in stored order (sorted by `order`, dropping unknowns).
  const sorted = stored
    .filter((s) => DASHBOARD_WIDGET_IDS.has(s.widgetId))
    .sort((a, b) => a.order - b.order);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    known.push({ widgetId: s.widgetId, enabled: s.enabled, order: i });
    seen.add(s.widgetId);
  }

  // Append newly-registered widgets that the user has never seen.
  let nextOrder = known.length;
  for (const w of DASHBOARD_WIDGETS) {
    if (seen.has(w.id)) continue;
    known.push({
      widgetId: w.id,
      enabled: byId.get(w.id)?.enabled ?? w.defaultEnabled,
      order: nextOrder++,
    });
  }
  return known;
}
