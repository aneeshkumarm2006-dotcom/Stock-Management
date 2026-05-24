// /properties/communication/emails/drafts — Drafts view.
// Phase 6 — PROPERTY_TODO line 614.
"use client";

import { EmailsSubtabs } from "@/components/pm/EmailsSubtabs";
import { EmailsListView } from "@/components/pm/EmailsListView";
import { PageHead } from "@/components/layout/PageHead";

export default function EmailsDraftsPage() {
  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Draft emails"
        subtitle="Saved compositions you can resume, edit, or delete."
      />
      <EmailsSubtabs active="drafts" />
      <EmailsListView mode="drafts" />
    </div>
  );
}
