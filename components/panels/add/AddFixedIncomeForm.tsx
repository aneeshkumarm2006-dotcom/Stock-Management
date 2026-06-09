"use client";

// Add GIC / Bond — fixed-income holdings valued by an auto-calculated maturity
// value (compound per payout frequency). Bond is identical to GIC under the
// hood; only the field labels change ("Issuer"/"Coupon rate"). A live preview
// shows the maturity value and the accrued value to-date.
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@/lib/utils/zodResolver";
import { useCreatePosition } from "@/lib/hooks/usePortfolio";
import type { AssetType, PayoutFrequency } from "@/lib/hooks/useDashboard";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";
import { useSettingsStore } from "@/store/useSettingsStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { maturityValue, accruedValue } from "@/lib/utils/assetValuation";
import { COMMON_CURRENCIES } from "@/lib/utils/exchangeMap";
import { Field, SelectField } from "../fields";
import { AddHoldingShell } from "./AddHoldingShell";
import { HeldByField } from "./HeldByField";

const FORM_ID = "add-fixed-income-form";

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

export function AddFixedIncomeForm({
  open,
  onClose,
  assetType,
  onTypeChange,
}: {
  open: boolean;
  onClose: () => void;
  assetType: AssetType; // "GIC" | "BOND"
  onTypeChange: (t: AssetType) => void;
}) {
  const isBond = assetType === "BOND";
  const { toast } = useToast();
  const create = useCreatePosition();
  const isOffline = useUiStore((s) => s.isOffline);
  const numberFormat = useSettingsStore((s) => s.numberFormat);

  const {
    register,
    handleSubmit,
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

  // Live valuation preview.
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
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to add a holding.",
        variant: "error",
      });
      return;
    }
    try {
      await create.mutateAsync({
        assetType: isBond ? "BOND" : "GIC",
        label: values.label.trim(),
        institution: values.institution.trim(),
        principal: Number(values.principal),
        currency: values.currency.toUpperCase(),
        startDate: values.startDate,
        maturityDate: values.maturityDate,
        interestRate: Number(values.interestRate),
        payoutFrequency: values.payoutFrequency,
        companyId: values.companyId ? values.companyId : null,
      });
      toast({
        title: isBond ? "Bond added" : "GIC added",
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
      title={isBond ? "Add Bond" : "Add GIC"}
      description={
        isBond
          ? "Fixed-income bond held to maturity. The value-at-maturity is calculated automatically from the coupon rate."
          : "Guaranteed Investment Certificate. The maturity value is calculated automatically from the interest rate and payout frequency."
      }
      formId={FORM_ID}
      submitLabel={isBond ? "Add Bond" : "Add GIC"}
      submitting={isSubmitting || create.isPending}
      disabled={isOffline}
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Field
          label="Name / Label"
          id="fi-label"
          placeholder={isBond ? "e.g. Canada 5yr 3.5%" : "e.g. RBC 18-month GIC"}
          error={errors.label?.message}
          {...register("label")}
        />

        <div className="grid grid-cols-2 gap-4">
          <Field
            label={isBond ? "Issuer" : "Bank / Institution"}
            id="fi-institution"
            placeholder={isBond ? "Issuer" : "RBC, TD, …"}
            error={errors.institution?.message}
            {...register("institution")}
          />
          <Field
            label="Currency"
            id="fi-currency"
            list="fi-currency-options"
            placeholder="CAD"
            maxLength={3}
            className="uppercase"
            error={errors.currency?.message}
            {...register("currency")}
          />
          <datalist id="fi-currency-options">
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Principal"
            id="fi-principal"
            type="number"
            step="any"
            min="0"
            placeholder="0.00"
            error={errors.principal?.message}
            {...register("principal")}
          />
          <Field
            label={isBond ? "Coupon rate (%)" : "Interest rate (%)"}
            id="fi-interestRate"
            type="number"
            step="any"
            min="0"
            placeholder="4.5"
            error={errors.interestRate?.message}
            {...register("interestRate")}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Start date"
            id="fi-startDate"
            type="date"
            error={errors.startDate?.message}
            {...register("startDate")}
          />
          <Field
            label="Maturity date"
            id="fi-maturityDate"
            type="date"
            error={errors.maturityDate?.message}
            {...register("maturityDate")}
          />
        </div>

        <SelectField
          label="Payout / compounding frequency"
          id="fi-payoutFrequency"
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
          id="fi-companyId"
          error={errors.companyId?.message}
          registerProps={register("companyId")}
        />
      </form>
    </AddHoldingShell>
  );
}
