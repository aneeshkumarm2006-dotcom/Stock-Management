"use client";

// Add / edit a company (held-by entity + its uninvested cash). One dialog
// serves both: `mode="create"` posts a new company, `mode="edit"` patches the
// passed one. Cash carries its own currency so it can be converted to the
// display currency in the portfolio total (PDR §9). Mutations are blocked
// offline, matching the position panels (PDR §11).
import { useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "@/components/panels/fields";
import { useToast } from "@/components/ui/toast";
import { useUiStore } from "@/store/useUiStore";
import {
  useCreateCompany,
  useUpdateCompany,
  type ApiCompany,
} from "@/lib/hooks/useCompanies";

// A pragmatic set of currencies for the picker; mirrors the position panel's
// common list. Cash currency is still a free 3-letter code server-side.
const CURRENCIES = [
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CHF",
  "HKD",
  "SGD",
  "INR",
  "CNY",
  "AED",
  "ILS",
];

export function CompanyFormDialog({
  open,
  mode,
  company,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  company?: ApiCompany | null;
  onClose: () => void;
}) {
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const create = useCreateCompany();
  const update = useUpdateCompany();

  const [name, setName] = useState("");
  const [cash, setCash] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);

  // Seed the fields each time the dialog opens (or the target company changes).
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && company) {
      setName(company.name);
      setCash(String(company.cashBalance ?? 0));
      setCurrency(company.cashCurrency ?? "USD");
    } else {
      setName("");
      setCash("");
      setCurrency("USD");
    }
  }, [open, mode, company]);

  const pending = create.isPending || update.isPending;

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Company name is required");
      return;
    }
    const cashNum = cash.trim() === "" ? 0 : Number(cash);
    if (!Number.isFinite(cashNum) || cashNum < 0) {
      setError("Cash balance cannot be negative");
      return;
    }
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to save companies.",
        variant: "error",
      });
      return;
    }

    try {
      if (mode === "edit" && company) {
        await update.mutateAsync({
          id: company.id,
          input: {
            name: trimmed,
            cashBalance: cashNum,
            cashCurrency: currency,
          },
        });
        toast({ title: "Company updated", variant: "success" });
      } else {
        await create.mutateAsync({
          name: trimmed,
          cashBalance: cashNum,
          cashCurrency: currency,
        });
        toast({ title: "Company added", variant: "success" });
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
          title={mode === "edit" ? "Edit company" : "Add company"}
          description="A company can hold stocks and a cash balance."
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
            label="Company name"
            id="company-name"
            placeholder="e.g. Ofra Iris, Ramco"
            value={name}
            maxLength={80}
            error={error ?? undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            autoFocus
          />

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Cash balance"
              id="company-cash"
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
            />
            <SelectField
              label="Cash currency"
              id="company-cash-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
          </div>
          {/* Submit lives in the footer button (form id wiring kept simple). */}
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
                Add company
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
