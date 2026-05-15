// Authenticated app shell: fixed Sidebar (≥ md), sticky TopBar, page content,
// and the MobileTabBar (< md). Route protection is enforced by middleware.ts
// (Stage 3); each data route additionally re-scopes by session userId.
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { SettingsHydrator } from "@/components/settings/SettingsHydrator";
import { NetworkStatus } from "@/components/providers/NetworkStatus";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <SettingsHydrator />
      <NetworkStatus />
      <Sidebar />
      <div className="flex min-h-screen flex-col md:pl-64">
        <TopBar />
        <main className="flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-8">
          {children}
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
