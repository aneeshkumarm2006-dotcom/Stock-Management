// Base shimmer block. Composed skeletons (cards, tables, stat strips) live in
// components/skeletons and build on this. PDR §12 — every async card/table
// shows a skeleton.
import { cn } from "@/lib/utils/cn";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded bg-surface-highest/70",
        className,
      )}
      {...props}
    />
  );
}
