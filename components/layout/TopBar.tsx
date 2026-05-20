"use client";

// Top bar: live market open/closed pill, last-refresh timestamp + manual
// refresh (force-revalidates the current page's queries — PDR §10), USD/CAD
// display toggle (Settings store, PDR §9), and the account menu.
import Link from "next/link";
import * as React from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Settings as SettingsIcon, LogOut } from "lucide-react";
import { getMarketStatus, formatEtTime } from "@/lib/utils/marketHours";
import { useAutoRefresh } from "@/lib/hooks/useAutoRefresh";
import { useUiStore } from "@/store/useUiStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { getWorkspaceForPath } from "@/components/layout/nav";
import { cn } from "@/lib/utils/cn";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Portfolio";

function MarketPill() {
  // Client-only clock to avoid SSR/hydration mismatch.
  const [status, setStatus] = React.useState<ReturnType<
    typeof getMarketStatus
  > | null>(null);

  React.useEffect(() => {
    const tick = () => setStatus(getMarketStatus());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const open = status?.open ?? false;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full px-3 py-1",
        open ? "bg-gain/10" : "bg-surface-highest",
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          open ? "animate-pulse bg-gain" : "bg-fg-muted",
        )}
      />
      <span
        className={cn(
          "text-[10px] font-bold uppercase tracking-widest",
          open ? "text-gain" : "text-fg-muted",
        )}
      >
        {status?.label ?? "Market —"}
      </span>
    </div>
  );
}

export function TopBar() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const pathname = usePathname();
  const lastRefreshAt = useUiStore((s) => s.lastRefreshAt);
  const markRefreshed = useUiStore((s) => s.markRefreshed);
  const requestForceRefresh = useUiStore((s) => s.requestForceRefresh);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);

  // The market status pill, last-updated label, and manual refresh button are
  // stocks-specific — in the Property Management workspace they're not
  // meaningful, so we hide them. The USD/CAD toggle stays (per client request).
  const isStocks = getWorkspaceForPath(pathname) === "stocks";

  // 60s market-open + page-focused auto-refresh lives here since the TopBar is
  // mounted for the whole authenticated shell (Stage 14, PDR §10).
  useAutoRefresh();

  const [refreshing, setRefreshing] = React.useState(false);

  // Manual refresh: open the bypass-cache window, then force-refetch only the
  // current page's mounted queries (`type: "active"`). Each refetch now appends
  // `?refresh=1`, so the server skips the cache TTL and pulls fresh provider
  // data (still quota hard-stopped — Stage 14, PDR §8/§10).
  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true);
    requestForceRefresh();
    try {
      await queryClient.refetchQueries({ type: "active" });
      markRefreshed();
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, markRefreshed, requestForceRefresh]);

  const lastRefreshLabel = lastRefreshAt
    ? `Last updated: ${formatEtTime(new Date(lastRefreshAt))}`
    : "Not yet refreshed";

  const user = session?.user;
  const initial = (user?.name ?? user?.email ?? "?")
    .charAt(0)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-surface-lowest">
      <div className="flex h-full w-full items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-4 md:gap-6">
          <span className="font-display text-sm font-bold text-fg md:hidden">
            {APP_NAME}
          </span>
          {isStocks && (
            <>
              <MarketPill />
              <div className="hidden h-4 w-px bg-border sm:block" />
              <div className="hidden items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-fg-muted sm:flex">
                <span>{lastRefreshLabel}</span>
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  aria-label="Refresh data"
                  className="transition-colors hover:text-primary disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                  />
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-4 md:gap-6">
          <div className="flex rounded border border-border bg-surface p-0.5">
            {(["USD", "CAD"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDisplayCurrency(c)}
                aria-pressed={displayCurrency === c}
                className={cn(
                  "rounded px-3 py-1 text-[10px] font-bold transition-colors",
                  displayCurrency === c
                    ? "bg-secondary-container text-primary"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {c}
              </button>
            ))}
          </div>

          <Dropdown
            trigger={
              <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-high text-xs font-bold text-fg">
                {user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external Google avatar; next/image not worth the loader config here
                  <img
                    src={user.image}
                    alt={user?.name ?? "Account"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initial
                )}
              </span>
            }
          >
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-sm font-semibold text-fg">
                {user?.name ?? "Account"}
              </p>
              {user?.email && (
                <p className="truncate text-xs text-fg-muted">
                  {user.email}
                </p>
              )}
            </div>
            <Link href="/settings">
              <DropdownItem>
                <SettingsIcon className="h-4 w-4" />
                Settings
              </DropdownItem>
            </Link>
            <DropdownItem
              className="text-error hover:text-error"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </DropdownItem>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
