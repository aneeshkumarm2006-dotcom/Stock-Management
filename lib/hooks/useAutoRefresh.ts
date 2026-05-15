"use client";

// Auto-refresh (Stage 14, PDR §10): every 60s, re-pull the *current page's*
// live queries — but only while the market is open AND the page is focused
// (visible). Closed market or a backgrounded tab → no polling, so we never
// burn API quota on data that isn't moving or that nobody is looking at.
//
// This does NOT open the force-refresh window, so each refetch is still served
// from the server-side cache within its TTL (quote TTL is ~1m while the market
// is open — Stage 4). Liveness without extra provider calls; the TopBar manual
// refresh is the only path that bypasses the cache.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isMarketOpen } from "@/lib/utils/marketHours";
import { useUiStore } from "@/store/useUiStore";

const INTERVAL_MS = 60_000;

export function useAutoRefresh() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const pageVisible = () =>
      typeof document === "undefined" ||
      document.visibilityState === "visible";

    const tick = () => {
      if (
        !pageVisible() ||
        !isMarketOpen() ||
        useUiStore.getState().isOffline
      ) {
        return;
      }
      // Only mounted (current-page) queries refetch; cached server data keeps
      // it quota-safe.
      void queryClient.refetchQueries({ type: "active" });
      useUiStore.getState().markRefreshed();
    };

    const start = () => {
      if (timer === null) timer = setInterval(tick, INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Pause the interval entirely while the tab is hidden; on return, refresh
    // immediately (if the market is open) and restart the 60s cadence.
    const onVisibility = () => {
      if (pageVisible()) {
        tick();
        start();
      } else {
        stop();
      }
    };

    if (pageVisible()) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [queryClient]);
}
