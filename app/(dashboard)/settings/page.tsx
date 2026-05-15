// Settings (PDR §5.7): display preferences, data management, API status.
// Each section is a self-contained client component; preferences mirror into
// the global Settings store so they re-apply across every page (the store is
// hydrated app-wide by SettingsHydrator in the dashboard layout).
import { DisplayPreferences } from "@/components/settings/DisplayPreferences";
import { DataManagement } from "@/components/settings/DataManagement";
import { ApiStatusPanel } from "@/components/settings/ApiStatusPanel";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-fg">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Display preferences, import/export, and live API usage.
        </p>
      </div>

      <DisplayPreferences />
      <DataManagement />
      <ApiStatusPanel />
    </div>
  );
}
