// Properties-workspace shell. Exists solely to mount PmCurrencyProvider once
// for every /properties route, so the top-bar USD/CAD toggle converts money
// throughout the PM module without any page threading currency props.
//
// Scoped here rather than in (dashboard)/layout.tsx so the stock workspace
// keeps its own, separate currency handling (portfolioMath) untouched.
//
// It also reserves the floating Compose-email button's safe area. Same
// reasoning for the scope: the FAB renders only on PM routes, so only PM
// routes should pay the extra bottom padding.
import { PmCurrencyProvider } from "@/components/pm/PmCurrencyProvider";
import { FAB_SAFE_AREA_CLASS } from "@/components/layout/FloatingActionCluster";

export default function PropertiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PmCurrencyProvider>
      <div className={FAB_SAFE_AREA_CLASS}>{children}</div>
    </PmCurrencyProvider>
  );
}
