// Card-shaped skeleton for a single Dashboard widget while async data loads.
// Renders in place of the widget body so the grid keeps its row alignment.
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

export function WidgetSkeleton({
  title,
  className,
  lines = 4,
}: {
  title: string;
  className?: string;
  lines?: number;
}) {
  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader>
        <span className="font-display text-sm font-bold uppercase tracking-wider text-fg-muted">
          {title}
        </span>
        <Skeleton className="h-5 w-16" />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardContent>
      <div className="border-t border-border px-5 py-3">
        <Skeleton className="h-3 w-24" />
      </div>
    </Card>
  );
}
