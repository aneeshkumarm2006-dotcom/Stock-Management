// PM settings sub-nav. Shared shell for /settings/pm/* pages.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const TABS: { href: string; label: string }[] = [
  { href: "/settings/pm", label: "Organization" },
  { href: "/settings/pm/custom-fields", label: "Custom fields" },
  { href: "/settings/pm/file-categories", label: "File categories" },
  { href: "/settings/pm/vendor-categories", label: "Vendor categories" },
  { href: "/settings/pm/task-categories", label: "Task categories" },
  { href: "/settings/pm/project-types", label: "Project types" },
];

export default function PmSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-fg">
          Property Management settings
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Org-level configuration that applies to every PM record.
        </p>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tab) => {
          const active =
            tab.href === "/settings/pm"
              ? pathname === tab.href
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "rounded-t px-3 py-2 text-sm transition-colors",
                active
                  ? "border-b-2 border-primary font-semibold text-primary"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
