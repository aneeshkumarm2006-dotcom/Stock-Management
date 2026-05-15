export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // App shell (Sidebar/TopBar/MobileTabBar) wired in Stage 6.
  return <>{children}</>;
}
