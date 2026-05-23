// Property Management Dashboard landing page (PROPERTY_TODO.md Phase 10,
// PDR_MASTER §2 / §8 Phase 10). 3-column widget grid aggregating signals
// across every prior phase. Layout is per-user customizable via the
// CustomizeDashboardModal launched from the header.
import { DashboardGrid } from "@/components/pm/dashboard/DashboardGrid";

export const metadata = {
  title: "Property Management",
};

export default function PropertyManagementHome() {
  return <DashboardGrid />;
}
