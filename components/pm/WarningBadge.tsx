"use client";

// Amber non-blocking warning UI. Two shapes share the same styling and the
// same filter (dismissed warnings are hidden):
//
//   <WarningInline warnings={...}/>   — used INSIDE create modals above
//                                        DialogFooter. Read-only, no Ignore
//                                        button because the form isn't
//                                        persisted yet. Each row is a single
//                                        bordered block.
//
//   <WarningBadge entityType entityId warnings onIgnored />  — used on list
//                                        rows and detail pages. Each warning
//                                        becomes its own amber pill with the
//                                        full message text and a small ×
//                                        button that POSTs to the dismiss
//                                        endpoint then calls `onIgnored` so
//                                        the parent can refresh.
//
// Styling matches the already-converted inline pattern in the codebase:
//   rounded-md border border-amber-200 bg-amber-50 text-amber-800
import * as React from "react";
import { AlertTriangle, X } from "lucide-react";
import type { PmWarning, WarningableType } from "@/lib/pm/warnings";
import { dismissWarning } from "@/lib/pm/dismissWarning";

function active(warnings: PmWarning[] | undefined): PmWarning[] {
  if (!warnings) return [];
  return warnings.filter((w) => !w.dismissedAt);
}

export function WarningInline({
  warnings,
  className = "",
}: {
  warnings: PmWarning[] | undefined;
  className?: string;
}) {
  const list = active(warnings);
  if (list.length === 0) return null;
  return (
    <div className={"space-y-1.5 " + className}>
      {list.map((w) => (
        <div
          key={w.code}
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  );
}

export function WarningBadge({
  entityType,
  entityId,
  warnings,
  onIgnored,
  layout = "stack",
  className = "",
}: {
  entityType: WarningableType;
  entityId: string;
  warnings: PmWarning[] | undefined;
  onIgnored?: () => void | Promise<void>;
  /** "stack" = full-width vertical alerts (detail page).
   *  "inline" = compact pills wrapping in a row (list row). */
  layout?: "stack" | "inline";
  className?: string;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const list = active(warnings);
  if (list.length === 0) return null;

  async function handleIgnore(code: string) {
    setBusy(code);
    try {
      await dismissWarning(entityType, entityId, code);
      if (onIgnored) await onIgnored();
    } finally {
      setBusy(null);
    }
  }

  if (layout === "stack") {
    return (
      <div className={"space-y-1.5 " + className}>
        {list.map((w) => (
          <div
            key={w.code}
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{w.message}</span>
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              onClick={() => handleIgnore(w.code)}
              disabled={busy === w.code}
              aria-label={`Ignore warning: ${w.code}`}
              title="Dismiss this warning"
            >
              <X className="h-3 w-3" /> Ignore
            </button>
          </div>
        ))}
      </div>
    );
  }

  // inline layout — compact pills suitable for list rows
  return (
    <span className={"inline-flex flex-wrap items-center gap-1 " + className}>
      {list.map((w) => (
        <span
          key={w.code}
          className="inline-flex max-w-[420px] items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800"
          title={w.message}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">{w.message}</span>
          <button
            type="button"
            className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-amber-200 disabled:opacity-50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleIgnore(w.code);
            }}
            disabled={busy === w.code}
            aria-label={`Ignore warning: ${w.code}`}
            title="Dismiss this warning"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </span>
  );
}
