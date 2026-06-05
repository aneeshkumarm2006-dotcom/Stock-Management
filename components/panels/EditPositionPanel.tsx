"use client";

// Edit Position slide-in panel (PDR §5.1). Two modes:
//   • Replace — set a new quantity and/or a new average buy price.
//   • Add to position — enter a follow-on lot; the new average is the
//     quantity-weighted mean (previewed live), matching the server recompute
//     in app/api/positions/[id]/route.ts ("add" mode).
// Driven by useUiStore.editPanelPositionId; the row is resolved from the
// portfolio rows passed by the page so the panel can show the current basis.
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Save } from "lucide-react";
import { zodResolver } from "@/lib/utils/zodResolver";
import { useUiStore } from "@/store/useUiStore";
import {
  useUpdatePosition,
  type PortfolioRow,
} from "@/lib/hooks/usePortfolio";
import { useCompanies } from "@/lib/hooks/useCompanies";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatNumber } from "@/lib/utils/formatNumber";
import { useSettingsStore } from "@/store/useSettingsStore";
import { SidePanel } from "./SidePanel";
import { Field, SelectField } from "./fields";
import { cn } from "@/lib/utils/cn";

const num = (v: string | undefined) => (v == null ? NaN : Number(v));

const schema = z
  .object({
    mode: z.enum(["replace", "add"]),
    quantity: z.string().optional(),
    avgBuyPrice: z.string().optional(),
    addQuantity: z.string().optional(),
    addPrice: z.string().optional(),
    // Held-by company is independent of the replace/add validation below.
    companyId: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.mode === "replace") {
      const hasQ = !!d.quantity?.trim();
      const hasA = !!d.avgBuyPrice?.trim();
      if (!hasQ && !hasA) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "Enter a new quantity and/or average",
        });
      }
      if (hasQ && !(num(d.quantity) > 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "Quantity must be greater than 0",
        });
      }
      if (hasA && !(Number.isFinite(num(d.avgBuyPrice)) && num(d.avgBuyPrice) >= 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["avgBuyPrice"],
          message: "Average buy price cannot be negative",
        });
      }
    } else {
      if (!(num(d.addQuantity) > 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["addQuantity"],
          message: "Added quantity must be greater than 0",
        });
      }
      if (!(Number.isFinite(num(d.addPrice)) && num(d.addPrice) >= 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["addPrice"],
          message: "Added price cannot be negative",
        });
      }
    }
  });
type FormValues = z.infer<typeof schema>;

export function EditPositionPanel({ rows }: { rows: PortfolioRow[] }) {
  const positionId = useUiStore((s) => s.editPanelPositionId);
  const closePanel = useUiStore((s) => s.closeEditPanel);
  const isOffline = useUiStore((s) => s.isOffline);
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const { toast } = useToast();
  const update = useUpdatePosition();
  const companies = useCompanies().data?.companies ?? [];

  const row = rows.find((r) => r.id === positionId) ?? null;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      mode: "replace",
      quantity: "",
      avgBuyPrice: "",
      addQuantity: "",
      addPrice: "",
      companyId: "",
    },
  });

  // Re-seed the form whenever a different position is opened.
  useEffect(() => {
    if (row) {
      reset({
        mode: "replace",
        quantity: String(row.quantity),
        avgBuyPrice: String(row.avgBuyPrice),
        addQuantity: "",
        addPrice: "",
        companyId: row.companyId ?? "",
      });
    }
  }, [row, reset]);

  const mode = watch("mode");
  const addQ = Number(watch("addQuantity"));
  const addP = Number(watch("addPrice"));

  const previewAvg =
    row &&
    mode === "add" &&
    Number.isFinite(addQ) &&
    addQ > 0 &&
    Number.isFinite(addP)
      ? (row.quantity * row.avgBuyPrice + addQ * addP) /
        (row.quantity + addQ)
      : null;
  const previewQty =
    row && mode === "add" && Number.isFinite(addQ) && addQ > 0
      ? row.quantity + addQ
      : null;

  const [pendingClose, setPendingClose] = useState(false);
  function close() {
    setPendingClose(true);
    closePanel();
  }
  useEffect(() => {
    if (pendingClose && !positionId) {
      reset();
      setPendingClose(false);
    }
  }, [pendingClose, positionId, reset]);

  async function onSubmit(values: FormValues) {
    if (!row) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to edit this position.",
        variant: "error",
      });
      return;
    }
    // Held-by is orthogonal to the qty/avg recompute. It rides the replace
    // path; in "add" mode it goes out as a small follow-up replace PATCH only
    // when the company actually changed (the server's add schema has no
    // companyId field).
    const nextCompanyId = values.companyId ? values.companyId : null;
    const companyChanged = nextCompanyId !== (row.companyId ?? null);

    try {
      if (values.mode === "add") {
        await update.mutateAsync({
          id: row.id,
          input: {
            mode: "add",
            addQuantity: Number(values.addQuantity),
            addPrice: Number(values.addPrice),
          },
        });
        if (companyChanged) {
          await update.mutateAsync({
            id: row.id,
            input: { mode: "replace", companyId: nextCompanyId },
          });
        }
      } else {
        const input: {
          mode: "replace";
          quantity?: number;
          avgBuyPrice?: number;
          companyId?: string | null;
        } = { mode: "replace" };
        if (values.quantity?.trim())
          input.quantity = Number(values.quantity);
        if (values.avgBuyPrice?.trim())
          input.avgBuyPrice = Number(values.avgBuyPrice);
        if (companyChanged) input.companyId = nextCompanyId;
        await update.mutateAsync({ id: row.id, input });
      }
      toast({
        title: "Position updated",
        description: `${row.ticker} cost basis saved.`,
        variant: "success",
      });
      close();
    } catch (err) {
      toast({
        title: "Update failed",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    }
  }

  return (
    <SidePanel
      open={Boolean(positionId)}
      onClose={close}
      title={row ? `Edit ${row.ticker}` : "Edit Position"}
      description={
        row
          ? `${row.name ?? row.ticker} · ${row.exchange} · ${row.nativeCurrency}`
          : undefined
      }
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-position-form"
            disabled={isSubmitting || update.isPending || !row || isOffline}
          >
            {isSubmitting || update.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      }
    >
      {row && (
        <form
          id="edit-position-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-5"
          noValidate
        >
          {/* Current basis */}
          <div className="rounded-md border border-border bg-surface-highest p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">
              Current Position
            </p>
            <div className="mt-2 flex items-end justify-between">
              <div>
                <p className="text-[10px] text-fg-muted">Quantity</p>
                <p className="font-display text-lg font-bold text-fg">
                  {formatNumber(row.quantity, {
                    format: numberFormat,
                    decimals: 0,
                  })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-fg-muted">Avg Buy</p>
                <p className="font-display text-lg font-bold text-fg">
                  {formatCurrency(row.avgBuyPrice, row.nativeCurrency, {
                    format: numberFormat,
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Mode switch */}
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-highest p-1">
            {(["replace", "add"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setValue("mode", m)}
                className={cn(
                  "rounded px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors",
                  mode === m
                    ? "bg-primary text-primary-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {m === "replace" ? "Replace" : "Add to position"}
              </button>
            ))}
          </div>
          <input type="hidden" {...register("mode")} />

          {mode === "replace" ? (
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="New Quantity"
                id="quantity"
                type="number"
                step="any"
                min="0"
                error={errors.quantity?.message}
                {...register("quantity")}
              />
              <Field
                label="New Avg Buy"
                id="avgBuyPrice"
                type="number"
                step="any"
                min="0"
                error={errors.avgBuyPrice?.message}
                {...register("avgBuyPrice")}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Add Quantity"
                  id="addQuantity"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0"
                  error={errors.addQuantity?.message}
                  {...register("addQuantity")}
                />
                <Field
                  label="Lot Price"
                  id="addPrice"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  error={errors.addPrice?.message}
                  {...register("addPrice")}
                />
              </div>
              <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                  Recomputed Basis
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <p className="text-[10px] text-fg-muted">New Quantity</p>
                    <p className="font-display text-base font-bold text-fg">
                      {previewQty == null
                        ? "—"
                        : formatNumber(previewQty, {
                            format: numberFormat,
                            decimals: 0,
                          })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-fg-muted">
                      New Weighted Avg
                    </p>
                    <p className="font-display text-base font-bold text-fg">
                      {previewAvg == null
                        ? "—"
                        : formatCurrency(previewAvg, row.nativeCurrency, {
                            format: numberFormat,
                          })}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          <SelectField
            label="Held by"
            id="edit-companyId"
            error={errors.companyId?.message}
            {...register("companyId")}
          >
            <option value="">None</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        </form>
      )}
    </SidePanel>
  );
}
