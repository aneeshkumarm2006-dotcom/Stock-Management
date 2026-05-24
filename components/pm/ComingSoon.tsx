// Shared placeholder for every Property Management route while the module is
// still being built. The sidebar nav exposes the full Buildium-inspired IA
// (PDR §6–§8) ahead of time so the client can navigate the shell; each child
// route lands here until its real screen is implemented. Visual treatment
// matches the Lattice design's `.coming-soon` block.
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ComingSoonProps {
  title?: string;
  description?: string;
}

export function ComingSoon({
  title = "Property Management",
  description = "This section is being built. The navigation is in place so you can preview the structure; the screens themselves will land in upcoming releases.",
}: ComingSoonProps) {
  return (
    <div className="flex min-h-[500px] flex-col items-center justify-center gap-4 px-10 py-[60px] text-center">
      <div className="grid h-16 w-16 place-items-center rounded-lg border border-border bg-surface-low text-fg-muted">
        <Sparkles className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <div>
        <h1 className="text-[20px] font-[650] tracking-[-0.018em] text-fg">
          {title}
        </h1>
        <p className="mt-2 max-w-[360px] text-[13px] leading-[1.5] text-fg-muted">
          {description}
        </p>
      </div>
      <Badge variant="brand">Coming in Phase 11</Badge>
    </div>
  );
}
