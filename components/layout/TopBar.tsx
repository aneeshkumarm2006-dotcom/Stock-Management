"use client";

// Top bar: breadcrumb derived from the URL on the left, contextual actions on
// the right. Lattice design pattern — page title/subtitle live in the body
// `PageHead`, not the topbar. Stocks-only items (market pill, last-refresh,
// manual refresh) are hidden in the PM workspace; PM-only items (bell badge)
// are hidden in Stocks. USD/CAD toggle and account menu are shared.
import * as React from "react";
import Link from "next/link";
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
import { BellBadge } from "@/components/pm/BellBadge";
import { useBreadcrumbOverrideLabel } from "@/components/layout/BreadcrumbOverride";
import { cn } from "@/lib/utils/cn";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Portfolio";

function MarketPill() {
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
        "flex items-center gap-[6px] rounded-full px-[10px] py-[3px]",
        open ? "bg-gain/10" : "bg-surface-highest",
      )}
    >
      <span
        className={cn(
          "h-[5px] w-[5px] rounded-full",
          open ? "animate-pulse bg-gain" : "bg-fg-muted",
        )}
      />
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.06em]",
          open ? "text-gain" : "text-fg-muted",
        )}
      >
        {status?.label ?? "Market —"}
      </span>
    </div>
  );
}

// Maps the active path to a human-readable crumb trail. Falls back to a
// title-cased version of each segment for routes the dictionary doesn't list.
const SEGMENT_LABELS: Record<string, string> = {
  stock: "Stocks",
  dashboard: "Dashboard",
  portfolio: "Portfolio",
  analytics: "Analytics",
  settings: "Settings",
  pm: "Organization",
  "custom-fields": "Custom fields",
  "file-categories": "File categories",
  "vendor-categories": "Vendor categories",
  "task-categories": "Task categories",
  "project-types": "Project types",
  mailboxes: "Mailboxes",
  properties: "Properties",
  rentals: "Rentals",
  tenants: "Tenants",
  "rental-owners": "Rental owners",
  "rent-roll": "Rent roll",
  units: "Units",
  leasing: "Leasing",
  listings: "Listings",
  prospects: "Prospects",
  applicants: "Applicants",
  "draft-leases": "Draft leases",
  "lease-management": "Lease management",
  "lease-renewals": "Lease renewals",
  accounting: "Accounting",
  "general-ledger": "General ledger",
  bills: "Bills",
  "owner-contributions": "Owner contributions",
  financials: "Financials",
  "chart-of-accounts": "Chart of accounts",
  budgets: "Budgets",
  "locked-periods": "Locked periods",
  banking: "Banking",
  "recurring-transactions": "Recurring transactions",
  "company-financials": "Company financials",
  "1099-tax-filings": "1099 tax filings",
  "eft-approvals": "EFT approvals",
  maintenance: "Maintenance",
  "work-orders": "Work orders",
  vendors: "Vendors",
  "property-inspections": "Property inspections",
  print: "Print",
  communication: "Communication",
  emails: "Emails",
  list: "Sent",
  scheduled: "Scheduled",
  drafts: "Drafts",
  threads: "Threads",
  "text-messages": "Text messages",
  announcements: "Announcements",
  mailings: "Mailings",
  templates: "Templates",
  "automated-email-settings": "Automated email",
  "public-site": "Public site",
  "resident-center-settings": "Resident Center",
  tasks: "Tasks",
  recurring: "Recurring",
  projects: "Projects",
  add: "New",
  calendars: "Calendars",
  files: "Files",
  reports: "Reports",
  "approval-rules": "Approval rules",
};

function labelFor(seg: string): string {
  // Hide opaque IDs (any segment with digits or > 12 chars) — they're usually
  // record identifiers and not useful in a breadcrumb.
  if (/^[0-9a-f]{6,}$/i.test(seg) || /^\d+$/.test(seg)) return "Detail";
  return (
    SEGMENT_LABELS[seg] ??
    seg
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  // STATE-015: a detail page can publish the resolved record name via the
  // BreadcrumbOverride context; when present, it replaces the leaf crumb (which
  // would otherwise be the opaque-ID fallback "Detail").
  const overrideLeaf = useBreadcrumbOverrideLabel();
  const segs = pathname.split("/").filter(Boolean);
  const labels = segs.map(labelFor);
  if (labels.length === 0) labels.push(APP_NAME);
  if (overrideLeaf && labels.length > 0) {
    labels[labels.length - 1] = overrideLeaf;
  }
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-[7px] text-[12.5px] font-medium text-fg-muted"
    >
      {labels.map((label, i) => {
        const last = i === labels.length - 1;
        return (
          <React.Fragment key={`${label}-${i}`}>
            {i > 0 && <span className="text-fg-muted/60">/</span>}
            <span className={last ? "font-semibold text-fg" : ""}>{label}</span>
          </React.Fragment>
        );
      })}
    </nav>
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

  const workspace = getWorkspaceForPath(pathname);
  const isStocks = workspace === "stocks";
  const isPm = workspace === "pm";

  useAutoRefresh();

  const [refreshing, setRefreshing] = React.useState(false);

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
    ? `Updated ${formatEtTime(new Date(lastRefreshAt))}`
    : "Not yet refreshed";

  const user = session?.user;
  const initial = (user?.name ?? user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 flex min-h-[56px] items-center gap-[14px] border-b border-border bg-surface-high px-4 md:px-6">
      <span className="font-display text-[13.5px] font-semibold tracking-tight text-fg md:hidden">
        {APP_NAME}
      </span>
      <div className="hidden md:block">
        <Breadcrumb pathname={pathname} />
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {isStocks && (
          <>
            <MarketPill />
            <div className="hidden h-[14px] w-px bg-border lg:block" />
            <div className="hidden items-center gap-[6px] text-[11px] font-medium text-fg-muted lg:flex">
              <span>{lastRefreshLabel}</span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label="Refresh data"
                className="grid h-[26px] w-[26px] place-items-center rounded-md border border-border bg-surface transition-colors hover:bg-surface-lowest hover:text-fg disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("h-[13px] w-[13px]", refreshing && "animate-spin")}
                />
              </button>
            </div>
          </>
        )}

        {isPm && <BellBadge />}

        <div className="flex rounded-md border border-border bg-surface p-[2px]">
          {(["USD", "CAD"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDisplayCurrency(c)}
              aria-pressed={displayCurrency === c}
              className={cn(
                "rounded px-[10px] py-[2px] text-[11px] font-semibold transition-colors",
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
            <span className="flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-full border border-border bg-surface-low text-[11px] font-semibold text-fg">
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
              <p className="truncate text-xs text-fg-muted">{user.email}</p>
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
    </header>
  );
}
