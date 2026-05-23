"use client";

// Client-side widget registry — maps the shared widget IDs from
// lib/pm/dashboardWidgets.ts onto their React component implementations.
// The grid resolves a layout entry's `widgetId` here at render time.
//
// Adding a widget = (1) add it to DASHBOARD_WIDGETS in lib/pm/dashboardWidgets,
// then (2) add the same id key here. The shared registry validates the id,
// the component map renders it.
import * as React from "react";
import { OutstandingBalancesWidget } from "./OutstandingBalancesWidget";
import { TasksWidget } from "./TasksWidget";
import { OverdueTasksWidget } from "./OverdueTasksWidget";
import { RentersInsuranceWidget } from "./RentersInsuranceWidget";
import { ExpiringRentersInsuranceWidget } from "./ExpiringRentersInsuranceWidget";
import { ExpiringLeasesWidget } from "./ExpiringLeasesWidget";
import { RentalListingsWidget } from "./RentalListingsWidget";
import { RentalApplicationsWidget } from "./RentalApplicationsWidget";
import { RecentActivityWidget } from "./RecentActivityWidget";
import { BankFeedWidget } from "./BankFeedWidget";

export type WidgetComponent = React.ComponentType;

export const WIDGET_COMPONENTS: Record<string, WidgetComponent> = {
  outstandingBalances: OutstandingBalancesWidget,
  tasks: TasksWidget,
  overdueTasks: OverdueTasksWidget,
  rentersInsurance: RentersInsuranceWidget,
  expiringRentersInsurance: ExpiringRentersInsuranceWidget,
  expiringLeases: ExpiringLeasesWidget,
  rentalListings: RentalListingsWidget,
  rentalApplications: RentalApplicationsWidget,
  recentActivity: RecentActivityWidget,
  bankFeed: BankFeedWidget,
};

// Widgets that should span 2 columns on `xl` (Bank Feed sits in row 4 in the
// PDR mockup, full-row-width on wide screens).
export const WIDGET_WIDE_ON_XL: ReadonlySet<string> = new Set(["bankFeed"]);
