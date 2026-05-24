// /properties/communication/emails/list — Sent view (default).
// Phase 6 — PROPERTY_TODO line 612.
"use client";

import { EmailsSubtabs } from "@/components/pm/EmailsSubtabs";
import { EmailsListView } from "@/components/pm/EmailsListView";
import { PageHead } from "@/components/layout/PageHead";

export default function EmailsSentPage() {
  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Emails"
        subtitle="Sent + scheduled + drafts. Compose from the floating button or any detail page Communications tab."
      />
      <EmailsSubtabs active="list" />
      <EmailsListView mode="sent" />
    </div>
  );
}
