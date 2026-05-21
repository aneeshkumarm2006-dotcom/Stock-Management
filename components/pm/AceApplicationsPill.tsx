"use client";

// ✓ Ace Applications pill — Phase 0 placeholder. Real wire-up arrives in
// Phase 3 when the Applicant entity ships and the auto-screening pipeline
// can surface "approval-ready" applications.
import { CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";

export function AceApplicationsPill() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast({
          title: "Ace Applications",
          description: "Available once the Applicants module ships (Phase 3).",
        })
      }
      className="flex items-center gap-1.5 rounded-full border border-gain/40 bg-gain/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gain transition-colors hover:bg-gain/20"
      aria-label="Ace applications"
    >
      <CheckCircle2 className="h-3 w-3" />
      Ace Applications
    </button>
  );
}

export default AceApplicationsPill;
