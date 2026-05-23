// /properties/communication/emails/threads — Conversation-grouped view.
// Phase 6 — PROPERTY_TODO line 615.
"use client";

import { EmailsSubtabs } from "@/components/pm/EmailsSubtabs";
import { EmailThreadsListView } from "@/components/pm/EmailThreadsListView";

export default function EmailsThreadsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-fg">Email threads</h1>
        <p className="text-sm text-fg-muted">
          Conversations grouped by subject + participants ([G-S-42]). Inbound
          replies arrive via the /api/pm/emails/ingest stub.
        </p>
      </header>
      <EmailsSubtabs active="threads" />
      <EmailThreadsListView />
    </div>
  );
}
