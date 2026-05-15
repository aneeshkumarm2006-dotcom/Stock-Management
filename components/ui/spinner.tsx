import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Spinner({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" aria-label={label}>
      <Loader2 className={cn("h-4 w-4 animate-spin", className)} />
    </span>
  );
}
