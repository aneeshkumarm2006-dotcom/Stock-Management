// Shared client fetcher for every TanStack Query hook (dashboard, portfolio,
// stock detail, market). One place so the manual-refresh "bypass the server
// cache" behaviour (Stage 14, PDR §10) is applied uniformly.
//
// When a manual refresh is in flight, `useUiStore.forceRefreshUntil` is set to
// a short future timestamp. While that window is open, every fetch this helper
// makes appends `?refresh=1`, which the market-data routes thread into
// `withCache({ forceRefresh })` so the TTL freshness check is skipped (still
// quota-gated — PDR §8). Outside that window (background refetch, the 60s
// auto-refresh, window-focus) requests are normal and served from the
// server-side cache within TTL, so liveness never burns the API quota.
import { useUiStore } from "@/store/useUiStore";

export async function fetchJson<T>(url: string): Promise<T> {
  const forcing = Date.now() < useUiStore.getState().forceRefreshUntil;
  const finalUrl = forcing
    ? url + (url.includes("?") ? "&" : "?") + "refresh=1"
    : url;

  const res = await fetch(finalUrl, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}
