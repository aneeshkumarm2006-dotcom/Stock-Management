"use client";

// Permanent tenant delete confirmation. Distinct from "Inactivate" (a
// reversible soft-archive that keeps the record and all its history): this
// wipes the tenant document for good — only the activity-log line survives.
// Because it is irreversible we gate it behind a typed "DELETE" confirmation,
// matching the "clear all data" flow (DataManagement). A tenant on a current
// lease is blocked up front; the server enforces the same with a 409 for the
// cosigner / future-lease edge cases the client can't see. Mutations are
// blocked while offline (PDR §11).
import * as React from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";

const CONFIRM_PHRASE = "DELETE";

export interface DeleteTenantTarget {
  id: string;
  displayName: string;
  /** A tenant must be Inactive before a permanent delete is allowed; an active
   *  tenant is blocked with a "make it inactive first" prompt. */
  active: boolean;
}

export function DeleteTenantDialog({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: DeleteTenantTarget | null;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const [phrase, setPhrase] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const blocked = Boolean(tenant?.active);
  const confirmed = phrase.trim().toUpperCase() === CONFIRM_PHRASE;

  // Reset the typed phrase each time the dialog opens for a tenant.
  React.useEffect(() => {
    if (tenant) setPhrase("");
  }, [tenant]);

  async function run() {
    if (!tenant || blocked || saving || !confirmed) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to delete this tenant.",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/pm/tenants/${tenant.id}?mode=permanent`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Delete failed",
          description: err.error ?? "Please try again.",
          variant: "error",
        });
        return;
      }
      toast({
        title: "Tenant deleted",
        description: `${tenant.displayName} was permanently removed.`,
        variant: "success",
      });
      onClose();
      await onDeleted();
    } catch {
      toast({
        title: "Delete failed",
        description: "Please try again.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(tenant)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title={blocked ? "Can't delete yet" : "Delete tenant permanently?"}
          description={
            !tenant
              ? undefined
              : blocked
                ? `${tenant.displayName} is still active.`
                : `${tenant.displayName} will be permanently removed. This cannot be undone.`
          }
          onClose={onClose}
        />
        {blocked ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface-highest p-3 text-[12px] text-fg-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
            <span>
              <strong className="text-fg">Inactivate</strong> this tenant first
              (it&apos;s reversible and keeps all history), then come back here to
              permanently delete them.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-error/40 bg-error/10 p-3 text-[12px] text-fg">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
              <p>
                This removes the tenant for good. Past leases keep the saved
                name, but the tenant record, contact details and notes/files on
                this page are gone. Prefer{" "}
                <strong>Inactivate</strong> if you might need them again.
              </p>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="confirm-delete-tenant"
                className="text-[12px] text-fg-muted"
              >
                Type{" "}
                <span className="font-bold text-loss">{CONFIRM_PHRASE}</span> to
                confirm.
              </label>
              <Input
                id="confirm-delete-tenant"
                value={phrase}
                autoFocus
                placeholder={CONFIRM_PHRASE}
                onChange={(e) => setPhrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmed) void run();
                }}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {blocked ? "Close" : "Cancel"}
          </Button>
          {!blocked && (
            <Button
              variant="destructive"
              onClick={() => void run()}
              disabled={!confirmed || saving || isOffline}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete permanently
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
