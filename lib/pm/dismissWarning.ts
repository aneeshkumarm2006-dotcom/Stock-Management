// Thin client helper so the WarningBadge component stays generic. Centralises
// the URL and shape so future renames are one-touch.
import type { WarningableType } from "@/lib/pm/warnings";

export async function dismissWarning(
  entityType: WarningableType,
  entityId: string,
  code: string,
): Promise<boolean> {
  try {
    const res = await fetch("/api/pm/warnings/dismiss", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, entityId, code }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
