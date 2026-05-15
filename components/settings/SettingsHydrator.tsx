"use client";

// Renders nothing — runs once in the dashboard shell to hydrate the Settings
// store from the authoritative server doc and apply the theme class, so the
// currency / number-format / theme preference re-applies on every page
// (Settings DoD, PDR §5.7). Kept separate from the server-component layout.
import { useSettingsSync } from "@/lib/hooks/useSettings";

export function SettingsHydrator() {
  useSettingsSync();
  return null;
}
