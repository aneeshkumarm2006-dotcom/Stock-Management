"use client";

// Network-offline detector (PDR §11, Stage 15). Mirrors the browser's
// online/offline state into useUiStore.isOffline — the single flag every
// mutation surface (Add/Edit/Delete panels, CSV import/export, Clear all,
// Display prefs) reads to block writes and that disables their submit
// controls. Without this listener `setOffline` is never called and those
// guards are dead code, so this component is what actually arms them.
//
// Renders nothing; mounted once in the authenticated shell where all
// mutations live (app/(dashboard)/layout.tsx).
import { useEffect, useRef } from "react";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";

export function NetworkStatus() {
  const setOffline = useUiStore((s) => s.setOffline);
  const { toast, dismiss } = useToast();
  // Track whether we've actually been offline so we don't fire a spurious
  // "back online" toast on the initial (already-online) mount.
  const wasOffline = useRef(false);
  // Id of the sticky offline toast, so we can clear it precisely when
  // connectivity returns instead of leaving it lingering.
  const offlineToastId = useRef<number | null>(null);

  useEffect(() => {
    const goOffline = () => {
      if (wasOffline.current) return;
      wasOffline.current = true;
      setOffline(true);
      offlineToastId.current = toast({
        title: "You're offline",
        description:
          "Live data is paused and changes are disabled until you reconnect.",
        variant: "error",
        duration: 0, // keep it up until connectivity returns
      });
    };

    const goOnline = () => {
      setOffline(false);
      if (offlineToastId.current !== null) {
        dismiss(offlineToastId.current);
        offlineToastId.current = null;
      }
      if (!wasOffline.current) return;
      wasOffline.current = false;
      toast({
        title: "Back online",
        description: "Reconnected — data and changes are available again.",
        variant: "success",
      });
    };

    // Seed from the current state (e.g. a reload while already offline).
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      goOffline();
    }

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [setOffline, toast, dismiss]);

  return null;
}
