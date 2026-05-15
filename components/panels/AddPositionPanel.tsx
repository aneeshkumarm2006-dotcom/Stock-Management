"use client";

// Add Position slide-in panel (PDR §5.1). Fields: ticker, exchange, quantity,
// average buy price, currency, optional buy date. Ticker has a Twelve Data
// symbol-search typeahead (debounced 300ms inside useSymbolSearch) that, on
// pick, prefills the listing's exchange + currency. On a successful create the
// async Finnhub metadata fetch is reflected once it lands (delayed positions
// invalidation in useCreatePosition). Driven by useUiStore.addPanelOpen so the
// dashboard empty-state CTA can prime it open.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Search, Plus } from "lucide-react";
import { zodResolver } from "@/lib/utils/zodResolver";
import { useUiStore } from "@/store/useUiStore";
import {
  useCreatePosition,
  useSymbolSearch,
  type SymbolSearchResult,
} from "@/lib/hooks/usePortfolio";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SidePanel } from "./SidePanel";
import { Field, SelectField, FieldError } from "./fields";

// Form values are strings (native inputs); converted on submit. The numeric
// rules mirror the server contract in app/api/positions/route.ts.
const schema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Ticker is required")
    .max(12, "Ticker is too long"),
  exchange: z.enum(["NYSE", "NASDAQ", "TSX"], {
    errorMap: () => ({ message: "Select an exchange" }),
  }),
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
  currency: z.enum(["USD", "CAD"]),
  buyDate: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

function mapExchange(raw: string): FormValues["exchange"] | null {
  const e = raw.toUpperCase();
  if (e.includes("TSX") || e === "TOR" || e === "NEO") return "TSX";
  if (e.includes("NASDAQ")) return "NASDAQ";
  if (e.includes("NYSE")) return "NYSE";
  return null;
}

export function AddPositionPanel() {
  const open = useUiStore((s) => s.addPanelOpen);
  const close = useUiStore((s) => s.closeAddPanel);
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const create = useCreatePosition();

  const [searchOpen, setSearchOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
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
    },
  });

  const tickerValue = watch("ticker");
  const { results, isSearching } = useSymbolSearch(
    searchOpen ? tickerValue : "",
  );

  function closeAndReset() {
    reset();
    setSearchOpen(false);
    close();
  }

  function pick(r: SymbolSearchResult) {
    setValue("ticker", r.symbol.toUpperCase(), { shouldValidate: true });
    const ex = mapExchange(r.exchange);
    if (ex) setValue("exchange", ex, { shouldValidate: true });
    const cur =
      r.currency === "USD" || r.currency === "CAD"
        ? (r.currency as FormValues["currency"])
        : r.country === "CA"
          ? "CAD"
          : "USD";
    setValue("currency", cur);
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
        ticker: values.ticker.trim().toUpperCase(),
        exchange: values.exchange,
        quantity: Number(values.quantity),
        avgBuyPrice: Number(values.avgBuyPrice),
        currency: values.currency,
        buyDate: values.buyDate ? values.buyDate : undefined,
      });
      toast({
        title: "Position added",
        description: `${values.ticker.toUpperCase()} is now in your portfolio.`,
        variant: "success",
      });
      closeAndReset();
    } catch (err) {
      // Invalid ticker / validation rejected by the server → inline error.
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
    <SidePanel
      open={open}
      onClose={closeAndReset}
      title="Add Position"
      description="Search a US or Canadian listing, then enter your cost basis."
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={closeAndReset}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-position-form"
            disabled={isSubmitting || create.isPending || isOffline}
          >
            {isSubmitting || create.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add Position
              </>
            )}
          </Button>
        </div>
      }
    >
      <form
        id="add-position-form"
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-5"
        noValidate
      >
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
              {...register("ticker", {
                onChange: () => setSearchOpen(true),
              })}
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
                  No US / Canadian listings found. You can still enter the
                  ticker manually.
                </div>
              ) : (
                results.slice(0, 12).map((r) => (
                  <button
                    key={`${r.symbol}:${r.exchange}`}
                    type="button"
                    onClick={() => pick(r)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-highest"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-fg">
                        {r.symbol}
                      </span>
                      <span className="block truncate text-[11px] text-fg-muted">
                        {r.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                      {r.exchange} · {r.country}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Exchange"
            id="exchange"
            error={errors.exchange?.message}
            {...register("exchange")}
          >
            <option value="NYSE">NYSE</option>
            <option value="NASDAQ">NASDAQ</option>
            <option value="TSX">TSX</option>
          </SelectField>
          <SelectField
            label="Currency"
            id="currency"
            error={errors.currency?.message}
            {...register("currency")}
          >
            <option value="USD">USD</option>
            <option value="CAD">CAD</option>
          </SelectField>
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
      </form>
    </SidePanel>
  );
}
