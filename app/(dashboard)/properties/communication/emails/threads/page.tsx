// /properties/communication/emails/threads — Conversation-grouped view.
// Phase 6 — PROPERTY_TODO line 615.
"use client";

import { EmailsSubtabs } from "@/components/pm/EmailsSubtabs";
import { EmailThreadsListView } from "@/components/pm/EmailThreadsListView";
import { PageHead } from "@/components/layout/PageHead";

export default function EmailsThreadsPage() {
  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Email threads"
        subtitle="Conversations grouped by subject + participants ([G-S-42]). Inbound replies arrive via the /api/pm/emails/ingest stub."
      />
      <EmailsSubtabs active="threads" />
      <EmailThreadsListView />
    </div>
  );
}
