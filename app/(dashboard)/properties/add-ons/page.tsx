// Phase 11 ComingSoon placeholder. Add-ons (third-party integrations) are
// intentionally out of scope for the current build — see PROPERTY_TODO.md
// Phase 11 and PDR_MASTER §9 Q6.
import { ComingSoon } from "@/components/pm/ComingSoon";

export const metadata = { title: "Add-ons — Property Management" };

export default function AddOnsPage() {
  return (
    <ComingSoon
      title="Add-ons"
      description="Third-party integrations and add-ons aren't part of the current build. Reach out to the product team if you have a specific integration request."
    />
  );
}
