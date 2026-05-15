// Single source of truth for primary navigation, shared by the desktop
// Sidebar and the mobile bottom tab bar so they never drift.
import {
  LayoutDashboard,
  Wallet,
  LineChart,
  PieChart,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/market", label: "Market", icon: LineChart },
  { href: "/analytics", label: "Analytics", icon: PieChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Active when the path equals the item or is a sub-route of it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
