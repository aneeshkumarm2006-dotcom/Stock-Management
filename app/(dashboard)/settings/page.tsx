// Settings (PDR §5.7): display preferences, data management, API status.
// Each section is a self-contained client component; preferences mirror into
// the global Settings store so they re-apply across every page (the store is
// hydrated app-wide by SettingsHydrator in the dashboard layout).
import { DisplayPreferences } from "@/components/settings/DisplayPreferences";
import { DataManagement } from "@/components/settings/DataManagement";
import { ApiStatusPanel } from "@/components/settings/ApiStatusPanel";
import { PageHead } from "@/components/layout/PageHead";

export default function SettingsPage() {
  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Settings"
        subtitle="Display preferences, import / export, and live API usage"
      />

      <DisplayPreferences />
      <DataManagement />
      <ApiStatusPanel />
    </div>
  );
}
