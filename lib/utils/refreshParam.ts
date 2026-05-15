// Server-side: read the manual-refresh signal off a market-data route request.
// The client appends `?refresh=1` only while a user-triggered manual refresh
// is in flight (see lib/utils/apiFetch.ts); routes pass the result into the
// api-client → withCache({ forceRefresh }) so the cache TTL is bypassed once,
// on demand, while still respecting the daily quota hard-stop (PDR §8, §10).
export function wantsRefresh(request: Request): boolean {
  try {
    return new URL(request.url).searchParams.get("refresh") === "1";
  } catch {
    return false;
  }
}
