// Phase 11 ComingSoon placeholder. Analytics Hub is intentionally out of scope
// for the current build — see PROPERTY_TODO.md Phase 11 and PDR_MASTER §9 Q6.
// Dashboard widgets cover the most-used KPIs in the meantime.
import { ComingSoon } from "@/components/pm/ComingSoon";

export const metadata = { title: "Analytics Hub — Property Management" };

export default function AnalyticsPage() {
  return (
    <ComingSoon
      title="Analytics Hub"
      description="The Analytics Hub isn't part of the current build. The Dashboard's widget grid covers the most-used KPIs (outstanding balances, occupancy, lease expirations) while this surface is in flight."
    />
  );
}
