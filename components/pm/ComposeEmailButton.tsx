"use client";

// + Compose email floating button (BR-CC-1). Phase 0 renders the surface;
// the Compose modal ships in Phase 6 once EmailMessage exists.
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/toast";

export function ComposeEmailButton() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast({
          title: "Compose email",
          description: "Available once the Communications module ships (Phase 6).",
        })
      }
      className="flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold uppercase tracking-widest text-primary-fg shadow-lg shadow-primary/30 transition-transform hover:scale-105"
      aria-label="Compose email"
    >
      <Plus className="h-4 w-4" />
      Compose email
    </button>
  );
}

export default ComposeEmailButton;
