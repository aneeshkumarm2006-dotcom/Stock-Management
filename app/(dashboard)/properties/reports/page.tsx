// Phase 11 ComingSoon placeholder. Reports is intentionally out of scope for
// the current build — see PROPERTY_TODO.md Phase 11 and PDR_MASTER §9 Q6.
// Accounting → Financials covers ledger-level reporting in the meantime.
import { ComingSoon } from "@/components/pm/ComingSoon";

export const metadata = { title: "Reports — Property Management" };

export default function ReportsPage() {
  return (
    <ComingSoon
      title="Reports"
      description="Custom and scheduled reports aren't part of the current build. Until this lands, the Accounting workspace covers ledger-level reporting (Financials, General ledger, Banking)."
    />
  );
}
