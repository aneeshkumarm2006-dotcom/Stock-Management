// PM settings sub-nav. Shared shell for /settings/pm/* pages.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { PageHead } from "@/components/layout/PageHead";

const TABS: { href: string; label: string }[] = [
  { href: "/settings/pm", label: "Organization" },
  { href: "/settings/pm/custom-fields", label: "Custom fields" },
  { href: "/settings/pm/file-categories", label: "File categories" },
  { href: "/settings/pm/vendor-categories", label: "Vendor categories" },
  { href: "/settings/pm/task-categories", label: "Task categories" },
  { href: "/settings/pm/project-types", label: "Project types" },
  { href: "/settings/pm/mailboxes", label: "Mailboxes" },
];

export default function PmSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-5xl space-y-[18px]">
      <PageHead
        title="Property Management settings"
        subtitle="Org-level configuration that applies to every PM record."
      />
      <nav className="flex flex-wrap gap-0 border-b border-border">
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
                "-mb-px flex items-center gap-[7px] border-b-2 px-[14px] py-[9px] text-[12.5px] font-medium transition-colors",
                active
                  ? "border-primary font-semibold text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
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
