// Properties-workspace shell. Exists solely to mount PmCurrencyProvider once
// for every /properties route, so the top-bar USD/CAD toggle converts money
// throughout the PM module without any page threading currency props.
//
// Scoped here rather than in (dashboard)/layout.tsx so the stock workspace
// keeps its own, separate currency handling (portfolioMath) untouched.
import { PmCurrencyProvider } from "@/components/pm/PmCurrencyProvider";

export default function PropertiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PmCurrencyProvider>{children}</PmCurrencyProvider>;
}
