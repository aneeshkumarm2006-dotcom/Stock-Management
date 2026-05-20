// Property Management workspace landing (PDR §6 — Dashboard). Placeholder
// until the operational dashboard widgets land.
import { ComingSoon } from "@/components/pm/ComingSoon";

export const metadata = {
  title: "Property Management",
};

export default function PropertyManagementHome() {
  return (
    <ComingSoon
      title="Property Management"
      description="Your operational dashboard, rentals, and leasing pipeline will live here. The full module is being built in phases — navigation is already in place so you can preview the structure."
    />
  );
}
