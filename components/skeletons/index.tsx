// Shared skeleton loaders for async cards and tables (PDR §12 — every async
// card/table renders a skeleton while loading). Built on the ui/Skeleton
// shimmer primitive; reused across dashboard, portfolio, market, analytics.
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

/** Generic content card placeholder. */
export function CardSkeleton({
  className,
  lines = 4,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-16" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

/** Stat-card placeholder; render N of these in a strip. */
export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-32 flex-col justify-between rounded-md border border-border bg-surface-high p-4",
        className,
      )}
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-20" />
    </div>
  );
}

export function StatStripSkeleton({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 md:grid-cols-5",
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Table placeholder with header + N rows / C columns. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex items-center gap-4 border-b border-border bg-surface/40 px-5 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-5 py-4">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
