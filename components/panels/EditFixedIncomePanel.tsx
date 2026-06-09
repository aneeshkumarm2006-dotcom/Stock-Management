"use client";

// Edit GIC / Bond. Replace-mode PATCH of the fixed-income fields with a live
// re-preview of the maturity + accrued value. Opens only when the row resolved
// from editPanelPositionId is a GIC or Bond; other types route elsewhere.
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
import type { PayoutFrequency } from "@/lib/hooks/useDashboard";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/useSettingsStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { maturityValue, accruedValue } from "@/lib/utils/assetValuation";
import { toDateInputValue } from "@/lib/utils/dateInput";
import { COMMON_CURRENCIES } from "@/lib/utils/exchangeMap";
import { SidePanel } from "./SidePanel";
import { Field, SelectField } from "./fields";
import { HeldByField } from "./add/HeldByField";

const FORM_ID = "edit-fixed-income-form";

const PAYOUTS: { value: PayoutFrequency; label: string }[] = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "SEMI_ANNUAL", label: "Semi-annual" },
  { value: "ANNUAL", label: "Annual" },
  { value: "AT_MATURITY", label: "At maturity" },
];

const schema = z
  .object({
    label: z.string().trim().min(1, "Name is required").max(120),
    institution: z.string().trim().min(1, "Institution is required").max(120),
    principal: z
      .string()
      .min(1, "Principal is required")
      .refine((v) => Number(v) > 0, "Principal must be greater than 0"),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter ISO code"),
    startDate: z.string().min(1, "Start date is required"),
    maturityDate: z.string().min(1, "Maturity date is required"),
    interestRate: z
      .string()
      .min(1, "Interest rate is required")
      .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Rate cannot be negative"),
    payoutFrequency: z.enum([
      "MONTHLY",
      "QUARTERLY",
      "SEMI_ANNUAL",
      "ANNUAL",
      "AT_MATURITY",
    ]),
    companyId: z.string().optional(),
  })
  .refine((d) => new Date(d.maturityDate) > new Date(d.startDate), {
    message: "Maturity date must be after the start date",
    path: ["maturityDate"],
  });
type FormValues = z.infer<typeof schema>;

export function EditFixedIncomePanel({ rows }: { rows: PortfolioRow[] }) {
  const positionId = useUiStore((s) => s.editPanelPositionId);
  const closePanel = useUiStore((s) => s.closeEditPanel);
  const isOffline = useUiStore((s) => s.isOffline);
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const { toast } = useToast();
  const update = useUpdatePosition();

  const resolved = rows.find((r) => r.id === positionId) ?? null;
  const isFixedIncome =
    resolved != null &&
    (resolved.assetType === "GIC" || resolved.assetType === "BOND");
  const row = isFixedIncome ? resolved : null;
  const isBond = row?.assetType === "BOND";

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: "",
      institution: "",
      principal: "",
      currency: "CAD",
      startDate: "",
      maturityDate: "",
      interestRate: "",
      payoutFrequency: "AT_MATURITY",
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
      institution: row.institution ?? "",
      principal: row.principal != null ? String(row.principal) : "",
      currency: row.nativeCurrency,
      startDate: toDateInputValue(row.startDate),
      maturityDate: toDateInputValue(row.maturityDate),
      interestRate: row.interestRate != null ? String(row.interestRate) : "",
      payoutFrequency: row.payoutFrequency ?? "AT_MATURITY",
      companyId: row.companyId ?? "",
    });
  }, [row, reset]);

  const v = watch();
  const preview =
    Number(v.principal) > 0 && v.startDate && v.maturityDate
      ? {
          maturity: maturityValue({
            principal: Number(v.principal),
            interestRate: Number(v.interestRate),
            payoutFrequency: v.payoutFrequency,
            startDate: v.startDate,
            maturityDate: v.maturityDate,
          }),
          accrued: accruedValue({
            principal: Number(v.principal),
            interestRate: Number(v.interestRate),
            payoutFrequency: v.payoutFrequency,
            startDate: v.startDate,
            maturityDate: v.maturityDate,
          }),
        }
      : null;
  const ccy = (v.currency || "CAD").toUpperCase();

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
          institution: values.institution.trim(),
          principal: Number(values.principal),
          currency: values.currency.toUpperCase(),
          startDate: values.startDate,
          maturityDate: values.maturityDate,
          interestRate: Number(values.interestRate),
          payoutFrequency: values.payoutFrequency,
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
      open={Boolean(positionId) && isFixedIncome}
      onClose={closePanel}
      title={row ? `Edit ${row.label}` : "Edit Holding"}
      description={row ? `${isBond ? "Bond" : "GIC"} · ${row.nativeCurrency}` : undefined}
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
            id="efi-label"
            error={errors.label?.message}
            {...register("label")}
          />
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={isBond ? "Issuer" : "Bank / Institution"}
              id="efi-institution"
              error={errors.institution?.message}
              {...register("institution")}
            />
            <Field
              label="Currency"
              id="efi-currency"
              list="efi-currency-options"
              maxLength={3}
              className="uppercase"
              error={errors.currency?.message}
              {...register("currency")}
            />
            <datalist id="efi-currency-options">
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Principal"
              id="efi-principal"
              type="number"
              step="any"
              min="0"
              error={errors.principal?.message}
              {...register("principal")}
            />
            <Field
              label={isBond ? "Coupon rate (%)" : "Interest rate (%)"}
              id="efi-interestRate"
              type="number"
              step="any"
              min="0"
              error={errors.interestRate?.message}
              {...register("interestRate")}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Start date"
              id="efi-startDate"
              type="date"
              error={errors.startDate?.message}
              {...register("startDate")}
            />
            <Field
              label="Maturity date"
              id="efi-maturityDate"
              type="date"
              error={errors.maturityDate?.message}
              {...register("maturityDate")}
            />
          </div>
          <SelectField
            label="Payout / compounding frequency"
            id="efi-payoutFrequency"
            error={errors.payoutFrequency?.message}
            {...register("payoutFrequency")}
          >
            {PAYOUTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </SelectField>

          {preview && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                Calculated value
              </p>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <p className="text-[10px] text-fg-muted">Accrued to date</p>
                  <p className="font-display text-base font-bold text-fg">
                    {formatCurrency(preview.accrued, ccy, { format: numberFormat })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-fg-muted">Value at maturity</p>
                  <p className="font-display text-base font-bold text-fg">
                    {formatCurrency(preview.maturity, ccy, { format: numberFormat })}
                  </p>
                </div>
              </div>
            </div>
          )}

          <HeldByField
            id="efi-companyId"
            label="Held by"
            error={errors.companyId?.message}
            registerProps={register("companyId")}
          />
        </form>
      )}
    </SidePanel>
  );
}
