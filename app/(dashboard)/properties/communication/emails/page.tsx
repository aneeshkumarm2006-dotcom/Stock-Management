// /properties/communication/emails — landing page. Default view is Sent
// per the sidebar entry in components/layout/nav.ts:194. Re-uses the same
// shell as /emails/list so the URL `…/emails` works without redirecting.
"use client";

import { EmailsSubtabs } from "@/components/pm/EmailsSubtabs";
import { EmailsListView } from "@/components/pm/EmailsListView";

export default function EmailsLandingPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-fg">Emails</h1>
        <p className="text-sm text-fg-muted">
          Sent + scheduled + drafts. Compose from the floating button or any
          detail page Communications tab.
        </p>
      </header>
      <EmailsSubtabs active="list" />
      <EmailsListView mode="sent" />
    </div>
  );
}
