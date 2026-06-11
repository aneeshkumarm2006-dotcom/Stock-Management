// Small info affordance that explains the three lease types (client email Q1:
// "what do Fixed, Fixed w/rollover, At-Will mean?"). Reused next to the Lease
// type dropdown in AssignLeaseModal and EditLeaseModal. Uses a native `title`
// tooltip on hover/focus — no extra UI dependency.
"use client";

import * as React from "react";
import { Info } from "lucide-react";

const LEASE_TYPE_HELP = [
  "Fixed — runs from the start date to a set end date, then ends.",
  "Fixed w/rollover — fixed term that continues month-to-month after the end date until either party ends it.",
  "At-will — no end date; continues until either party ends it.",
].join("\n");

export function LeaseTypeHelp() {
  return (
    <span
      className="ml-1 inline-flex cursor-help align-middle text-fg-muted"
      title={LEASE_TYPE_HELP}
      aria-label={LEASE_TYPE_HELP}
      tabIndex={0}
    >
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}

export default LeaseTypeHelp;
