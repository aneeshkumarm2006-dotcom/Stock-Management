"use client";

// Add / rename a broker (the brokerage/custodian a holding is held at). One
// dialog serves both: `mode="create"` posts a new broker, `mode="edit"`
// renames the passed one. Mutations are blocked offline, matching the position
// panels (PDR §11). Mirrors CompanyFormDialog, minus the cash fields.
import { useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/panels/fields";
import { useToast } from "@/components/ui/toast";
import { useUiStore } from "@/store/useUiStore";
import {
  useCreateBroker,
  useUpdateBroker,
  type ApiBroker,
} from "@/lib/hooks/useBrokers";

export function BrokerFormDialog({
  open,
  mode,
  broker,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  broker?: ApiBroker | null;
  onClose: () => void;
}) {
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const create = useCreateBroker();
  const update = useUpdateBroker();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Seed the field each time the dialog opens (or the target broker changes).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(mode === "edit" && broker ? broker.name : "");
  }, [open, mode, broker]);

  const pending = create.isPending || update.isPending;

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Broker name is required");
      return;
    }
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to save brokers.",
        variant: "error",
      });
      return;
    }

    try {
      if (mode === "edit" && broker) {
        await update.mutateAsync({ id: broker.id, input: { name: trimmed } });
        toast({ title: "Broker updated", variant: "success" });
      } else {
        await create.mutateAsync({ name: trimmed });
        toast({ title: "Broker added", variant: "success" });
      }
      onClose();
    } catch (err) {
      // e.g. duplicate name (409) — surface inline so the user can fix it.
      setError(
        err instanceof Error ? err.message : "Couldn't save. Please try again.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader
          title={mode === "edit" ? "Rename broker" : "Add broker"}
          description="A broker is the brokerage/custodian a holding is held at."
          onClose={onClose}
        />

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            label="Broker name"
            id="broker-name"
            placeholder="e.g. Fidelity, Wealthsimple, Schwab"
            value={name}
            maxLength={80}
            error={error ?? undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            autoFocus
          />
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || isOffline}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : mode === "edit" ? (
              <>
                <Save className="h-4 w-4" />
                Save changes
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add broker
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
