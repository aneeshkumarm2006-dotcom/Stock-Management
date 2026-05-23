"use client";

// Greeting + ⚙ Customize dashboard control (PROPERTY_TODO.md Phase 10).
// Reads session.user.name for the first-name greeting; falls back to email
// prefix. Customize button is enabled once the layout has loaded.
import * as React from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import { CustomizeDashboardModal } from "./CustomizeDashboardModal";
import type { LayoutItem } from "./DashboardGrid";

function timeOfDay(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function firstName(name: string | null | undefined, email: string | null | undefined): string {
  if (name && name.trim().length > 0) {
    return name.trim().split(/\s+/)[0] ?? "";
  }
  if (email) return email.split("@")[0] ?? "";
  return "there";
}

export function DashboardHeader({
  layout,
  onSaved,
}: {
  layout: LayoutItem[] | null;
  onSaved: (next: LayoutItem[]) => void;
}) {
  const { data: session } = useSession();
  const [open, setOpen] = React.useState(false);
  // Compute the greeting on the client to dodge SSR/locale-tz hydration drift.
  const [tod, setTod] = React.useState<string>("afternoon");
  React.useEffect(() => setTod(timeOfDay()), []);

  const greeting = `Good ${tod}, ${firstName(
    session?.user?.name,
    session?.user?.email,
  )}!`;

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="font-display text-xl font-bold text-fg">{greeting}</h1>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!layout}
        className="inline-flex items-center gap-2 self-start rounded border border-border bg-surface-low px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-fg-muted transition-colors hover:bg-surface-high hover:text-fg disabled:opacity-50 sm:self-auto"
      >
        <SettingsIcon className="h-3.5 w-3.5" />
        Customize dashboard
      </button>
      {layout && (
        <CustomizeDashboardModal
          open={open}
          onOpenChange={setOpen}
          layout={layout}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

export default DashboardHeader;
