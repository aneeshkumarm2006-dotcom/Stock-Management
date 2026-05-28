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
import { Field, FieldError } from "./fields";

// Form values mirror the server contract in app/api/positions/route.ts:
// exchange and currency are free uppercase strings so any venue Twelve Data
// surfaces (LSE, XETRA, HKEX, NSE, ASX, …) is storable. Currency must still
// be a 3-letter ISO code.
const schema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Ticker is required")
    .max(20, "Ticker is too long"),
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
});
type FormValues = z.infer<typeof schema>;

// Twelve Data returns `exchange` (human label like "NYSE Arca") and `mic_code`
// (ISO 10383 MIC like "ARCX"). We translate both to one of the venue keys in
// finnhub.ts EXCHANGE_META so the async profile fetch picks the right ticker
// suffix (.TO, .L, .DE, …). Anything we don't recognise is passed through
// uppercased — the server accepts it and Twelve Data /quote works regardless.
const MIC_TO_VENUE: Record<string, string> = {
  // North America
  XNYS: "NYSE",
  ARCX: "ARCA",
  XASE: "AMEX",
  BATS: "BATS",
  IEXG: "NYSE",
  XCBO: "BATS",
  EDGX: "BATS",
  EDGA: "BATS",
  OOTC: "OTC",
  XNAS: "NASDAQ",
  XTSE: "TSX",
  XTSX: "TSXV",
  XCNQ: "CSE",
  NEOE: "NEO",
  XCNX: "CSE",
  // Europe
  XLON: "LSE",
  XETR: "XETRA",
  XFRA: "FRANKFURT",
  XPAR: "PARIS",
  XAMS: "AMSTERDAM",
  XBRU: "BRUSSELS",
  XMIL: "MILAN",
  XMAD: "MADRID",
  XLIS: "LISBON",
  XSTO: "STOCKHOLM",
  XHEL: "HELSINKI",
  XOSL: "OSLO",
  XCSE: "COPENHAGEN",
  XSWX: "SIX",
  XWBO: "VIENNA",
  XWAR: "WARSAW",
  XIST: "ISTANBUL",
  // Asia-Pacific
  XASX: "ASX",
  XNZE: "NZX",
  XTKS: "TSE",
  XHKG: "HKEX",
  XSHG: "SSE",
  XSHE: "SZSE",
  XKRX: "KRX",
  XKOS: "KOSDAQ",
  XTAI: "TWSE",
  XSES: "SGX",
  XNSE: "NSE",
  XBOM: "BSE",
  XBKK: "SET",
  XIDX: "IDX",
  XKLS: "KLSE",
  // Americas (ex-NA)
  BVMF: "B3",
  XMEX: "BMV",
  XBUE: "BCBA",
  // Middle East / Africa
  XTAE: "TASE",
  XSAU: "TADAWUL",
  XJSE: "JSE",
};

const LABEL_TO_VENUE: Record<string, string> = {
  "NYSE ARCA": "ARCA",
  "NYSE AMERICAN": "AMEX",
  AMEX: "AMEX",
  BATS: "BATS",
  CBOE: "BATS",
  IEX: "NYSE",
  OTC: "OTC",
  "TSX VENTURE": "TSXV",
  TSXV: "TSXV",
  NEO: "NEO",
  CSE: "CSE",
};

function mapExchange(raw: string, mic?: string): string {
  if (mic) {
    const m = MIC_TO_VENUE[mic.toUpperCase()];
    if (m) return m;
  }
  const e = raw.trim().toUpperCase();
  if (LABEL_TO_VENUE[e]) return LABEL_TO_VENUE[e];
  if (e.includes("NASDAQ")) return "NASDAQ";
  if (e.includes("NYSE")) return "NYSE";
  if (e.includes("TSX")) return "TSX";
  // Anything else — pass through uppercased so the server stores it as-is.
  return e || "NYSE";
}

// Common venue suggestions for the datalist; user can still type anything.
const COMMON_EXCHANGES = [
  "NYSE",
  "NASDAQ",
  "AMEX",
  "ARCA",
  "BATS",
  "OTC",
  "TSX",
  "TSXV",
  "NEO",
  "CSE",
  "LSE",
  "XETRA",
  "PARIS",
  "AMSTERDAM",
  "MILAN",
  "MADRID",
  "SIX",
  "ASX",
  "TSE",
  "HKEX",
  "NSE",
  "BSE",
  "SGX",
  "KRX",
  "B3",
  "BMV",
];

const COMMON_CURRENCIES = [
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
  "KRW",
  "BRL",
  "MXN",
  "ZAR",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
];

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
      description="Search any listing Twelve Data covers — stocks, ETFs, mutual funds, ADRs, REITs across 50+ global exchanges — then enter your cost basis."
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
                  No matching listings. You can still enter the ticker
                  manually.
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
                        <span className="text-xs font-bold text-fg">
                          {r.symbol}
                        </span>
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
      </form>
    </SidePanel>
  );
}
