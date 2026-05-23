"use client";

// + Compose email floating button (BR-CC-1). Phase 6 wires it to the
// ComposeEmailModal. Visible on every PM page via FloatingActionCluster.
import * as React from "react";
import { Plus } from "lucide-react";
import { ComposeEmailModal } from "@/components/pm/ComposeEmailModal";

export function ComposeEmailButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold uppercase tracking-widest text-primary-fg shadow-lg shadow-primary/30 transition-transform hover:scale-105"
        aria-label="Compose email"
      >
        <Plus className="h-4 w-4" />
        Compose email
      </button>
      <ComposeEmailModal open={open} onOpenChange={setOpen} />
    </>
  );
}

export default ComposeEmailButton;
