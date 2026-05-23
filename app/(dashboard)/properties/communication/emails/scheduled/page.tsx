// /properties/communication/emails/scheduled — Scheduled view.
// Phase 6 — PROPERTY_TODO line 613.
"use client";

import { EmailsSubtabs } from "@/components/pm/EmailsSubtabs";
import { EmailsListView } from "@/components/pm/EmailsListView";

export default function EmailsScheduledPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-fg">Scheduled emails</h1>
        <p className="text-sm text-fg-muted">
          Queued for future send. The dispatch-scheduled-emails cron promotes
          them to Sent when their scheduledSendTime elapses.
        </p>
      </header>
      <EmailsSubtabs active="scheduled" />
      <EmailsListView mode="scheduled" />
    </div>
  );
}
