"use client";

// STATE-001 / STATE-002: the persisted Zustand stores use `skipHydration: true`
// so their localStorage values are NOT read during the initial render pass —
// that keeps the server-rendered markup and the client's first paint identical
// (no React hydration mismatch on `sidebarCollapsed`, the USD/CAD toggle's
// `aria-pressed`, or the theme). This component runs a client-only mount effect
// that triggers the deferred rehydration once, after hydration has committed.
//
// (The dark/light <html> class itself is applied synchronously *before* React
// boots by the inline themeBootScript in app/layout.tsx, so there is no FOUC.)
import * as React from "react";
import { useUiStore } from "@/store/useUiStore";
import { useSettingsStore } from "@/store/useSettingsStore";

export function StoreHydrator() {
  React.useEffect(() => {
    void useUiStore.persist.rehydrate();
    void useSettingsStore.persist.rehydrate();
  }, []);
  return null;
}

export default StoreHydrator;
