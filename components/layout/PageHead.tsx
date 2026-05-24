// Lattice "page-head" pattern: a body-level header block sitting above the
// page content with the title, an optional subtitle, and a right-aligned
// actions cluster. Opt-in — pages render this near the top of `main` instead
// of inventing their own header treatment.
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface PageHeadProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHead({
  title,
  subtitle,
  actions,
  className,
}: PageHeadProps) {
  return (
    <div
      className={cn(
        "mb-[18px] flex items-end justify-between gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[18px] font-[650] tracking-[-0.018em] text-fg">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[12.5px] text-fg-muted">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export default PageHead;
