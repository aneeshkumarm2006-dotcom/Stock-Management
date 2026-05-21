// Single source of truth for primary navigation. Two workspaces share the
// authenticated shell: "stocks" (the original product, /stock/*) and "pm"
// (Property Management, /properties/*). The URL prefix decides which workspace
// is active; the Sidebar / MobileTabBar render the matching nav tree.
import {
  LayoutDashboard,
  Wallet,
  PieChart,
  Settings,
  Building2,
  ListChecks,
  Users,
  UserCog,
  AlertCircle,
  ClipboardList,
  ClipboardCheck,
  Megaphone,
  Search,
  FileText,
  RefreshCw,
  Repeat,
  Calculator,
  Wrench,
  CheckSquare,
  MessageSquare,
  Calendar,
  FolderOpen,
  BarChart3,
  TrendingUp,
  Home,
  LineChart,
  BookOpen,
  Landmark,
  Receipt,
  RotateCw,
  CheckCircle,
  PiggyBank,
  List,
  FileSpreadsheet,
  Truck,
  Hammer,
  Mail,
  MessageCircle,
  Send,
  Bell,
  Zap,
  UserCircle,
  Globe,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceId = "stocks" | "pm";

export interface Workspace {
  id: WorkspaceId;
  label: string;
  icon: LucideIcon;
  /** Where the workspace switcher lands the user when they pick this. */
  landing: string;
}

export const WORKSPACES: readonly Workspace[] = [
  { id: "stocks", label: "Stocks", icon: TrendingUp, landing: "/stock/dashboard" },
  { id: "pm", label: "Property Management", icon: Home, landing: "/properties" },
] as const;

export interface NavItem {
  kind?: "item";
  href: string;
  label: string;
  icon: LucideIcon;
  /** Renders the item visibly but inert (PDR §4.1 — future modules). */
  disabled?: boolean;
}

export interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavItem[];
}

export type NavNode = NavItem | NavGroup;

export function isNavGroup(n: NavNode): n is NavGroup {
  return (n as NavGroup).kind === "group";
}

/** Active when the path equals the item or is a sub-route of it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True if any leaf inside the group matches the current path. */
export function isActiveGroup(pathname: string, group: NavGroup): boolean {
  return group.children.some((c) => isActivePath(pathname, c.href));
}

/** Derives the active workspace from the current URL — URL is the source of truth. */
export function getWorkspaceForPath(pathname: string): WorkspaceId {
  if (pathname === "/properties" || pathname.startsWith("/properties/")) return "pm";
  if (pathname === "/settings/pm" || pathname.startsWith("/settings/pm/")) return "pm";
  return "stocks";
}

const STOCKS_NAV: NavNode[] = [
  { href: "/stock/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/stock/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/stock/analytics", label: "Analytics", icon: PieChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

// PM nav mirrors the Buildium IA per PDR §6, §7, §8. Out-of-scope modules
// (Accounting, Maintenance, …) are listed as disabled so the layout matches
// Buildium's left rail visually.
const PM_NAV: NavNode[] = [
  { href: "/properties", label: "Dashboard", icon: LayoutDashboard },
  {
    kind: "group",
    id: "rentals",
    label: "Rentals",
    icon: Building2,
    children: [
      { href: "/properties/rentals/properties", label: "Properties", icon: Building2 },
      { href: "/properties/rentals/rent-roll", label: "Rent roll", icon: ListChecks },
      { href: "/properties/rentals/tenants", label: "Tenants", icon: Users },
      { href: "/properties/rentals/rental-owners", label: "Rental owners", icon: UserCog },
      { href: "/properties/rentals/outstanding-balances", label: "Outstanding balances", icon: AlertCircle },
    ],
  },
  {
    kind: "group",
    id: "leasing",
    label: "Leasing",
    icon: ClipboardList,
    children: [
      { href: "/properties/leasing/listings", label: "Listings", icon: Megaphone },
      { href: "/properties/leasing/prospects", label: "Prospects", icon: Search },
      { href: "/properties/leasing/applicants", label: "Applicants", icon: ClipboardList },
      { href: "/properties/leasing/draft-leases", label: "Draft leases", icon: FileText },
      { href: "/properties/leasing/lease-renewals", label: "Lease renewals", icon: RefreshCw },
      { href: "/properties/leasing/lease-management", label: "Leasing", icon: Repeat },
    ],
  },
  {
    kind: "group",
    id: "accounting",
    label: "Accounting",
    icon: Calculator,
    children: [
      { href: "/properties/accounting/financials", label: "Financials", icon: LineChart },
      { href: "/properties/accounting/general-ledger", label: "General ledger", icon: BookOpen },
      { href: "/properties/accounting/banking", label: "Banking", icon: Landmark },
      { href: "/properties/accounting/bills", label: "Bills", icon: Receipt },
      { href: "/properties/accounting/recurring-transactions", label: "Recurring transactions", icon: RotateCw },
      { href: "/properties/accounting/eft-approvals", label: "EFT approvals", icon: CheckCircle },
      { href: "/properties/accounting/budgets", label: "Budgets", icon: PiggyBank },
      { href: "/properties/accounting/chart-of-accounts", label: "Chart of accounts", icon: List },
      { href: "/properties/accounting/locked-periods", label: "Locked periods", icon: Calculator },
      { href: "/properties/accounting/company-financials", label: "Company financials", icon: Building2 },
      { href: "/properties/accounting/1099-tax-filings", label: "1099 tax filings", icon: FileSpreadsheet },
    ],
  },
  {
    kind: "group",
    id: "maintenance",
    label: "Maintenance",
    icon: Wrench,
    children: [
      { href: "/properties/maintenance/vendors", label: "Vendors", icon: Truck },
      { href: "/properties/maintenance/work-orders", label: "Work orders", icon: Hammer },
      { href: "/properties/maintenance/property-inspections", label: "Property inspections", icon: ClipboardCheck },
    ],
  },
  { href: "/properties/tasks", label: "Tasks", icon: CheckSquare },
  {
    kind: "group",
    id: "communication",
    label: "Communication",
    icon: MessageSquare,
    children: [
      { href: "/properties/communication/emails", label: "Emails", icon: Mail },
      { href: "/properties/communication/text-messages", label: "Text messages", icon: MessageCircle },
      { href: "/properties/communication/mailings", label: "Mailings", icon: Send },
      { href: "/properties/communication/announcements", label: "Announcements", icon: Bell },
      { href: "/properties/communication/templates", label: "Mailing and email templates", icon: FileText },
      { href: "/properties/communication/automated-email-settings", label: "Automated email settings", icon: Zap },
      { href: "/properties/communication/resident-center-settings", label: "Resident Center settings", icon: UserCircle },
      { href: "/properties/communication/public-site", label: "Public site", icon: Globe },
    ],
  },
  { href: "/properties/calendars", label: "Calendars", icon: Calendar },
  { href: "/properties/files", label: "Files", icon: FolderOpen },
  { href: "/properties/reports", label: "Reports", icon: BarChart3 },
  { href: "/properties/analytics", label: "Analytics Hub", icon: PieChart },
  { href: "/settings/pm", label: "Settings", icon: Settings },
];

export function getNavForWorkspace(ws: WorkspaceId): NavNode[] {
  return ws === "pm" ? PM_NAV : STOCKS_NAV;
}

/** Top-level entries usable in a flat bar (mobile tab bar). Groups collapse to their first child. */
export function flatTopLevel(nodes: NavNode[]): NavItem[] {
  return nodes
    .map((n): NavItem | null => {
      if (isNavGroup(n)) {
        const first = n.children[0];
        return first ? { href: first.href, label: n.label, icon: n.icon } : null;
      }
      return n.disabled ? null : n;
    })
    .filter((n): n is NavItem => n !== null);
}
