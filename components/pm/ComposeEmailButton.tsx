"use client";

// + Compose email floating button (BR-CC-1). Phase 6 wires it to the
// ComposeEmailModal. Visible on every PM page via FloatingActionCluster.
//
// LAYOUT. This floats over page content, so it has two ways of getting in the
// way and needs both closed off:
//
//   1. Vertically — it sat on top of the last rows of long tables (the
//      Financials matrix totals, the tail of the recurring-transactions list).
//      Fixed by reserving space at the foot of every PM page; see
//      `FAB_SAFE_AREA_CLASS` in components/layout/FloatingActionCluster.tsx,
//      which the properties layout applies. Vertical clearance is the real fix
//      — it guarantees anything can be scrolled clear of the button.
//
//   2. Horizontally — the full "Compose email" pill is ~180px wide, which
//      covers a meaningful slice of a wide, side-scrolling table. So the
//      button rests as a 48px circle and expands to the labelled pill on
//      hover or keyboard focus. The label still exists for screen readers via
//      aria-label, and the icon keeps the same blue affordance in the same
//      corner.
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
        // `group` + max-width transition: the label is always in the DOM (so
        // the accessible name and hit target stay stable) but is clipped to
        // zero width until hover/focus. Transitioning max-width rather than
        // toggling `hidden` keeps the expand smooth and avoids a layout jump
        // that would make the button hard to click on the way in.
        className="group flex h-12 items-center gap-0 overflow-hidden rounded-full bg-primary pl-4 pr-4 text-sm font-bold uppercase tracking-widest text-primary-fg shadow-lg shadow-primary/30 transition-[padding,box-shadow] duration-200 hover:pr-5 hover:shadow-xl focus-visible:pr-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label="Compose email"
      >
        <Plus className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-200 group-hover:ml-2 group-hover:max-w-[12rem] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[12rem] group-focus-visible:opacity-100">
          Compose email
        </span>
      </button>
      <ComposeEmailModal open={open} onOpenChange={setOpen} />
    </>
  );
}

export default ComposeEmailButton;
