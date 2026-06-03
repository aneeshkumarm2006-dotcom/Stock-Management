// Authenticated app shell: fixed Sidebar (≥ md), sticky TopBar, page content,
// and the MobileTabBar (< md). Route protection is enforced by middleware.ts
// (Stage 3); each data route additionally re-scopes by session userId.
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { FloatingActionCluster } from "@/components/layout/FloatingActionCluster";
import { SettingsHydrator } from "@/components/settings/SettingsHydrator";
import { NetworkStatus } from "@/components/providers/NetworkStatus";
import { BreadcrumbOverrideProvider } from "@/components/layout/BreadcrumbOverride";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-high">
      <SettingsHydrator />
      <NetworkStatus />
      <Sidebar />
      {/* STATE-015: shared breadcrumb-override store. Wraps both the TopBar
          (reader) and the page content (where a detail page sets the leaf
          label), so a record-detail route can show the resolved name instead
          of the literal "Detail" crumb. */}
      <BreadcrumbOverrideProvider>
        <DashboardShell>
          <TopBar />
          <main className="flex-1 px-4 pb-24 pt-[22px] md:px-[28px] md:pb-[28px]">
            {children}
          </main>
        </DashboardShell>
      </BreadcrumbOverrideProvider>
      <MobileTabBar />
      <FloatingActionCluster />
    </div>
  );
}
