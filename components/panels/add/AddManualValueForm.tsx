"use client";

// Add Mutual fund / Cash — manually-valued holdings. A private mutual fund
// tracks a book cost plus a current market value (refreshed monthly); cash is
// just a single value. valueAsOf defaults to today so a freshly-added fund is
// considered up to date for the current month.
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@/lib/utils/zodResolver";
import { useCreatePosition } from "@/lib/hooks/usePortfolio";
import type { AssetType } from "@/lib/hooks/useDashboard";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";
import { COMMON_CURRENCIES } from "@/lib/utils/exchangeMap";
import { todayInputValue } from "@/lib/utils/dateInput";
import { Field } from "../fields";
import { AddHoldingShell } from "./AddHoldingShell";
import { HeldByField } from "./HeldByField";

const FORM_ID = "add-manual-form";

const schema = z.object({
  label: z.string().trim().min(1, "Name is required").max(120),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter ISO code"),
  costBasis: z.string().optional(),
  currentValue: z
    .string()
    .min(1, "Current value is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Value cannot be negative"),
  valueAsOf: z.string().optional(),
  companyId: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function AddManualValueForm({
  open,
  onClose,
  assetType,
  onTypeChange,
}: {
  open: boolean;
  onClose: () => void;
  assetType: AssetType; // "MUTUAL_FUND" | "CASH"
  onTypeChange: (t: AssetType) => void;
}) {
  const isFund = assetType === "MUTUAL_FUND";
  const { toast } = useToast();
  const create = useCreatePosition();
  const isOffline = useUiStore((s) => s.isOffline);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: "",
      currency: "CAD",
      costBasis: "",
      currentValue: "",
      valueAsOf: todayInputValue(),
      companyId: "",
    },
  });

  async function onSubmit(values: FormValues) {
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to add a holding.",
        variant: "error",
      });
      return;
    }
    try {
      if (isFund) {
        await create.mutateAsync({
          assetType: "MUTUAL_FUND",
          label: values.label.trim(),
          currency: values.currency.toUpperCase(),
          costBasis: Number(values.costBasis || 0),
          currentValue: Number(values.currentValue),
          valueAsOf: values.valueAsOf ? values.valueAsOf : undefined,
          companyId: values.companyId ? values.companyId : null,
        });
      } else {
        await create.mutateAsync({
          assetType: "CASH",
          label: values.label.trim(),
          currency: values.currency.toUpperCase(),
          currentValue: Number(values.currentValue),
          companyId: values.companyId ? values.companyId : null,
        });
      }
      toast({
        title: isFund ? "Mutual fund added" : "Holding added",
        description: `${values.label.trim()} is now in your portfolio.`,
        variant: "success",
      });
      onClose();
    } catch (err) {
      toast({
        title: "Could not add holding",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    }
  }

  return (
    <AddHoldingShell
      open={open}
      onClose={onClose}
      assetType={assetType}
      onTypeChange={onTypeChange}
      title={isFund ? "Add Mutual Fund" : "Add Cash / Other"}
      description={
        isFund
          ? "Private mutual fund with no public price. Enter the current market value; you'll refresh it monthly."
          : "A manually-valued holding such as a savings balance or other asset."
      }
      formId={FORM_ID}
      submitLabel={isFund ? "Add Fund" : "Add Holding"}
      submitting={isSubmitting || create.isPending}
      disabled={isOffline}
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Field
          label="Name / Label"
          id="mv-label"
          placeholder={isFund ? "e.g. Ofra Iris Private Fund" : "e.g. Cash reserve"}
          error={errors.label?.message}
          {...register("label")}
        />

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Currency"
            id="mv-currency"
            list="mv-currency-options"
            placeholder="CAD"
            maxLength={3}
            className="uppercase"
            error={errors.currency?.message}
            {...register("currency")}
          />
          <datalist id="mv-currency-options">
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {isFund && (
            <Field
              label="Cost (book value)"
              id="mv-costBasis"
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              error={errors.costBasis?.message}
              {...register("costBasis")}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label={isFund ? "Current market value" : "Value"}
            id="mv-currentValue"
            type="number"
            step="any"
            min="0"
            placeholder="0.00"
            error={errors.currentValue?.message}
            {...register("currentValue")}
          />
          {isFund && (
            <Field
              label="Value as of"
              id="mv-valueAsOf"
              type="date"
              error={errors.valueAsOf?.message}
              {...register("valueAsOf")}
            />
          )}
        </div>

        <HeldByField
          id="mv-companyId"
          error={errors.companyId?.message}
          registerProps={register("companyId")}
        />
      </form>
    </AddHoldingShell>
  );
}
