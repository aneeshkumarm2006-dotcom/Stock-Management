"use client";

// Add Stock / ETF form — the original AddPositionPanel body, now one of the
// type-specific forms behind AddHoldingShell. Ticker has a Twelve Data
// symbol-search typeahead that prefills exchange + currency on pick.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Search } from "lucide-react";
import { zodResolver } from "@/lib/utils/zodResolver";
import {
  useCreatePosition,
  useSymbolSearch,
  type SymbolSearchResult,
} from "@/lib/hooks/usePortfolio";
import type { AssetType } from "@/lib/hooks/useDashboard";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  COMMON_CURRENCIES,
  COMMON_EXCHANGES,
  mapExchange,
} from "@/lib/utils/exchangeMap";
import { Field, FieldError } from "../fields";
import { AddHoldingShell } from "./AddHoldingShell";
import { HeldByField } from "./HeldByField";

const FORM_ID = "add-equity-form";

const schema = z.object({
  ticker: z.string().trim().min(1, "Ticker is required").max(20, "Ticker is too long"),
  exchange: z
    .string()
    .trim()
    .min(1, "Exchange is required")
    .max(32, "Exchange code is too long"),
  quantity: z
    .string()
    .min(1, "Quantity is required")
    .refine((v) => Number(v) > 0, "Quantity must be greater than 0"),
  avgBuyPrice: z
    .string()
    .min(1, "Average buy price is required")
    .refine(
      (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
      "Average buy price cannot be negative",
    ),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter ISO code"),
  buyDate: z.string().optional(),
  companyId: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function AddEquityForm({
  open,
  onClose,
  assetType,
  onTypeChange,
}: {
  open: boolean;
  onClose: () => void;
  assetType: AssetType;
  onTypeChange: (t: AssetType) => void;
}) {
  const { toast } = useToast();
  const create = useCreatePosition();
  const isOffline = useUiStore((s) => s.isOffline);
  const [searchOpen, setSearchOpen] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ticker: "",
      exchange: "NASDAQ",
      quantity: "",
      avgBuyPrice: "",
      currency: "USD",
      buyDate: "",
      companyId: "",
    },
  });

  const tickerValue = watch("ticker");
  const { results, isSearching } = useSymbolSearch(searchOpen ? tickerValue : "");

  function pick(r: SymbolSearchResult) {
    setValue("ticker", r.symbol.toUpperCase(), { shouldValidate: true });
    setValue("exchange", mapExchange(r.exchange, r.micCode), {
      shouldValidate: true,
    });
    if (r.currency) {
      setValue("currency", r.currency.toUpperCase(), { shouldValidate: true });
    }
    setSearchOpen(false);
  }

  async function onSubmit(values: FormValues) {
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to add a position.",
        variant: "error",
      });
      return;
    }
    try {
      await create.mutateAsync({
        assetType: "EQUITY",
        ticker: values.ticker.trim().toUpperCase(),
        exchange: values.exchange,
        quantity: Number(values.quantity),
        avgBuyPrice: Number(values.avgBuyPrice),
        currency: values.currency,
        buyDate: values.buyDate ? values.buyDate : undefined,
        companyId: values.companyId ? values.companyId : null,
      });
      toast({
        title: "Position added",
        description: `${values.ticker.toUpperCase()} is now in your portfolio.`,
        variant: "success",
      });
      onClose();
    } catch (err) {
      setError("ticker", {
        type: "server",
        message:
          err instanceof Error
            ? err.message
            : "Could not add this position. Check the ticker and try again.",
      });
    }
  }

  return (
    <AddHoldingShell
      open={open}
      onClose={onClose}
      assetType={assetType}
      onTypeChange={onTypeChange}
      title="Add Stock / ETF"
      description="Search any listing Twelve Data covers — stocks, ETFs, ADRs, REITs across 50+ global exchanges — then enter your cost basis."
      formId={FORM_ID}
      submitLabel="Add Position"
      submitting={isSubmitting || create.isPending}
      disabled={isOffline}
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {/* Ticker + typeahead */}
        <div className="relative">
          <Label htmlFor="ticker" className="mb-1.5 block">
            Ticker
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
            <Input
              id="ticker"
              autoComplete="off"
              placeholder="Search ticker or company…"
              className="pl-9 uppercase"
              aria-invalid={errors.ticker ? true : undefined}
              {...register("ticker", { onChange: () => setSearchOpen(true) })}
            />
          </div>
          <FieldError message={errors.ticker?.message} />

          {searchOpen && tickerValue.trim().length >= 1 && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface-high shadow-2xl">
              {isSearching ? (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-fg-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching…
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-xs text-fg-muted">
                  No matching listings. You can still enter the ticker manually.
                </div>
              ) : (
                results.slice(0, 12).map((r) => (
                  <button
                    key={`${r.symbol}:${r.exchange}:${r.micCode ?? ""}`}
                    type="button"
                    onClick={() => pick(r)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-highest"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-bold text-fg">{r.symbol}</span>
                        {r.instrumentType && (
                          <span className="rounded bg-surface-highest px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-fg-muted">
                            {r.instrumentType}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-fg-muted">
                        {r.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                      <span className="block">{r.exchange}</span>
                      <span className="block opacity-70">
                        {r.country}
                        {r.currency ? ` · ${r.currency}` : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Exchange"
            id="exchange"
            list="exchange-options"
            placeholder="NYSE, TSX, LSE…"
            className="uppercase"
            error={errors.exchange?.message}
            {...register("exchange")}
          />
          <datalist id="exchange-options">
            {COMMON_EXCHANGES.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <Field
            label="Currency"
            id="currency"
            list="currency-options"
            placeholder="USD"
            maxLength={3}
            className="uppercase"
            error={errors.currency?.message}
            {...register("currency")}
          />
          <datalist id="currency-options">
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Quantity"
            id="quantity"
            type="number"
            step="any"
            min="0"
            placeholder="0"
            error={errors.quantity?.message}
            {...register("quantity")}
          />
          <Field
            label="Avg Buy Price"
            id="avgBuyPrice"
            type="number"
            step="any"
            min="0"
            placeholder="0.00"
            error={errors.avgBuyPrice?.message}
            {...register("avgBuyPrice")}
          />
        </div>

        <Field
          label="Buy Date (optional)"
          id="buyDate"
          type="date"
          error={errors.buyDate?.message}
          {...register("buyDate")}
        />

        <HeldByField
          id="equity-companyId"
          error={errors.companyId?.message}
          registerProps={register("companyId")}
        />
      </form>
    </AddHoldingShell>
  );
}
