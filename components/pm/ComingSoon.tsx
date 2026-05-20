// Shared placeholder for every Property Management route while the module is
// still being built. The sidebar nav exposes the full Buildium-inspired IA
// (PDR §6–§8) ahead of time so the client can navigate the shell; each child
// route lands here until its real screen is implemented.
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ComingSoonProps {
  title?: string;
  description?: string;
}

export function ComingSoon({
  title = "Property Management",
  description = "This section is being built. The navigation is in place so you can preview the structure; the screens themselves will land in upcoming releases.",
}: ComingSoonProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-16">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary-container/40 text-primary">
            <Construction className="h-7 w-7" />
          </span>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-fg">{title}</h1>
            <p className="text-sm leading-relaxed text-fg-muted">
              {description}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-fg-muted">
            Coming soon
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
