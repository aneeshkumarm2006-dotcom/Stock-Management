"use client";

// Edit Mutual fund / Cash. Replace-mode PATCH of the manual fields. The fund
// variant exposes cost + current value + value-as-of; cash is just a single
// value. Opens only when the resolved row is a MUTUAL_FUND or CASH.
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Save } from "lucide-react";
import { zodResolver } from "@/lib/utils/zodResolver";
import { useUiStore } from "@/store/useUiStore";
import {
  useUpdatePosition,
  type PortfolioRow,
} from "@/lib/hooks/usePortfolio";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { COMMON_CURRENCIES } from "@/lib/utils/exchangeMap";
import { toDateInputValue } from "@/lib/utils/dateInput";
import { SidePanel } from "./SidePanel";
import { Field } from "./fields";
import { HeldByField } from "./add/HeldByField";

const FORM_ID = "edit-manual-form";

const schema = z.object({
  label: z.string().trim().min(1, "Name is required").max(120),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter ISO code"),
  costBasis: z.string().optional(),
  currentValue: z
    .string()
    .min(1, "Value is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Value cannot be negative"),
  valueAsOf: z.string().optional(),
  companyId: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function EditManualPanel({ rows }: { rows: PortfolioRow[] }) {
  const positionId = useUiStore((s) => s.editPanelPositionId);
  const closePanel = useUiStore((s) => s.closeEditPanel);
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const update = useUpdatePosition();

  const resolved = rows.find((r) => r.id === positionId) ?? null;
  const isManual =
    resolved != null &&
    (resolved.assetType === "MUTUAL_FUND" || resolved.assetType === "CASH");
  const row = isManual ? resolved : null;
  const isFund = row?.assetType === "MUTUAL_FUND";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: "",
      currency: "CAD",
      costBasis: "",
      currentValue: "",
      valueAsOf: "",
      companyId: "",
    },
  });

  // Re-seed only when a different holding is opened (keyed on id, not the `row`
  // object). A background auto-refresh rebuilds rows and hands us a new `row`
  // reference for the same holding; re-seeding then would clobber an in-progress
  // edit such as a just-picked "Held by" company before the user can save it.
  const seededIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!row) {
      seededIdRef.current = null;
      return;
    }
    if (seededIdRef.current === row.id) return;
    seededIdRef.current = row.id;
    reset({
      label: row.label ?? "",
      currency: row.nativeCurrency,
      costBasis: row.costBasis != null ? String(row.costBasis) : "",
      currentValue:
        row.currentValueNative != null ? String(row.currentValueNative) : "",
      valueAsOf: toDateInputValue(row.valueAsOf),
      companyId: row.companyId ?? "",
    });
  }, [row, reset]);

  async function onSubmit(values: FormValues) {
    if (!row) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to edit this holding.",
        variant: "error",
      });
      return;
    }
    try {
      await update.mutateAsync({
        id: row.id,
        input: {
          mode: "replace",
          label: values.label.trim(),
          currency: values.currency.toUpperCase(),
          currentValue: Number(values.currentValue),
          ...(isFund
            ? {
                costBasis: Number(values.costBasis || 0),
                valueAsOf: values.valueAsOf ? values.valueAsOf : undefined,
              }
            : {}),
          companyId: values.companyId ? values.companyId : null,
        },
      });
      toast({
        title: "Holding updated",
        description: `${values.label.trim()} saved.`,
        variant: "success",
      });
      closePanel();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    }
  }

  return (
    <SidePanel
      open={Boolean(positionId) && isManual}
      onClose={closePanel}
      title={row ? `Edit ${row.label}` : "Edit Holding"}
      description={
        row
          ? `${isFund ? "Mutual fund" : "Cash / Other"} · ${row.nativeCurrency}`
          : undefined
      }
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={closePanel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
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
        <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <Field
            label="Name / Label"
            id="em-label"
            error={errors.label?.message}
            {...register("label")}
          />
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Currency"
              id="em-currency"
              list="em-currency-options"
              maxLength={3}
              className="uppercase"
              error={errors.currency?.message}
              {...register("currency")}
            />
            <datalist id="em-currency-options">
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {isFund && (
              <Field
                label="Cost (book value)"
                id="em-costBasis"
                type="number"
                step="any"
                min="0"
                error={errors.costBasis?.message}
                {...register("costBasis")}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={isFund ? "Current market value" : "Value"}
              id="em-currentValue"
              type="number"
              step="any"
              min="0"
              error={errors.currentValue?.message}
              {...register("currentValue")}
            />
            {isFund && (
              <Field
                label="Value as of"
                id="em-valueAsOf"
                type="date"
                error={errors.valueAsOf?.message}
                {...register("valueAsOf")}
              />
            )}
          </div>
          <HeldByField
            id="em-companyId"
            label="Held by"
            error={errors.companyId?.message}
            registerProps={register("companyId")}
          />
        </form>
      )}
    </SidePanel>
  );
}
