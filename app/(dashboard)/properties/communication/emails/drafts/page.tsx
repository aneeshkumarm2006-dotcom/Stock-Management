// /properties/communication/emails/drafts — Drafts view.
// Phase 6 — PROPERTY_TODO line 614.
"use client";

import { EmailsSubtabs } from "@/components/pm/EmailsSubtabs";
import { EmailsListView } from "@/components/pm/EmailsListView";

export default function EmailsDraftsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-fg">Draft emails</h1>
        <p className="text-sm text-fg-muted">
          Saved compositions you can resume, edit, or delete.
        </p>
      </header>
      <EmailsSubtabs active="drafts" />
      <EmailsListView mode="drafts" />
    </div>
  );
}
