// /properties/communication/emails/scheduled — Scheduled view.
// Phase 6 — PROPERTY_TODO line 613.
"use client";

import { EmailsSubtabs } from "@/components/pm/EmailsSubtabs";
import { EmailsListView } from "@/components/pm/EmailsListView";
import { PageHead } from "@/components/layout/PageHead";

export default function EmailsScheduledPage() {
  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Scheduled emails"
        subtitle="Queued for future send. The dispatch-scheduled-emails cron promotes them to Sent when their scheduledSendTime elapses."
      />
      <EmailsSubtabs active="scheduled" />
      <EmailsListView mode="scheduled" />
    </div>
  );
}
