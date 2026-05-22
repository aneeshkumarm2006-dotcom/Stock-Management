// Single applicant-checklist row. Used on the Applicant detail Application
// tab. The `systemChecked` flag drives the auto-check banner — Phase 6 will
// also set it on inbound email receipts (BR-LA-7).
"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

interface ChecklistItem {
  id: string;
  stage: 1 | 2 | 3;
  label: string;
  checked: boolean;
  checkedAt?: string | null;
  systemChecked: boolean;
}

interface ChecklistItemToggleProps {
  applicantId: string;
  item: ChecklistItem;
  onChanged: () => void | Promise<void>;
}

export function ChecklistItemToggle({
  applicantId,
  item,
  onChanged,
}: ChecklistItemToggleProps) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function toggle() {
    setBusy(true);
    const res = await fetch(
      `/api/pm/applicants/${applicantId}/checklist/${item.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: !item.checked }),
      },
    );
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Checklist update failed",
        description: err.error ?? "Try again.",
        variant: "error",
      });
      return;
    }
    await onChanged();
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded border px-3 py-2">
      <label className="flex items-center gap-3 cursor-pointer flex-1">
        <input
          type="checkbox"
          checked={item.checked}
          disabled={busy}
          onChange={toggle}
        />
        <div className="flex flex-col">
          <span
            className={`text-sm ${item.checked ? "line-through text-muted-foreground" : ""}`}
          >
            {item.label}
          </span>
          {item.checkedAt && (
            <span className="text-xs text-muted-foreground">
              {item.systemChecked
                ? `Auto-checked by System on ${new Date(item.checkedAt).toLocaleDateString()}`
                : `Checked on ${new Date(item.checkedAt).toLocaleDateString()}`}
            </span>
          )}
        </div>
      </label>
      {item.systemChecked && <Badge variant="outline">System</Badge>}
    </div>
  );
}
