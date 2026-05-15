"use client";

// Holdings filter/search bar (PDR §5.3): client-side search by ticker or
// company name + exchange / sector / country filters. State is lifted to the
// page so the table and the "showing N" footer stay in sync.
import { Search, RotateCcw } from "lucide-react";

export interface HoldingsFilter {
  query: string;
  exchange: "ALL" | "NYSE" | "NASDAQ" | "TSX";
  sector: string; // "ALL" or a sector name
  country: "ALL" | "US" | "CA";
}

export const DEFAULT_FILTER: HoldingsFilter = {
  query: "",
  exchange: "ALL",
  sector: "ALL",
  country: "ALL",
};

const selectCls =
  "h-9 rounded border border-border bg-surface px-3 text-xs text-fg focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary";

export function PortfolioFilters({
  filter,
  onChange,
  sectors,
}: {
  filter: HoldingsFilter;
  onChange: (next: HoldingsFilter) => void;
  sectors: string[];
}) {
  const set = <K extends keyof HoldingsFilter>(
    key: K,
    value: HoldingsFilter[K],
  ) => onChange({ ...filter, [key]: value });

  const isDirty =
    filter.query !== "" ||
    filter.exchange !== "ALL" ||
    filter.sector !== "ALL" ||
    filter.country !== "ALL";

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-high p-4 lg:flex-row lg:items-center">
      <div className="relative w-full lg:w-96">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input
          type="text"
          value={filter.query}
          onChange={(e) => set("query", e.target.value)}
          placeholder="Filter by ticker or name…"
          className="h-9 w-full rounded border border-border bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted/60 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Filter by exchange"
          className={selectCls}
          value={filter.exchange}
          onChange={(e) =>
            set("exchange", e.target.value as HoldingsFilter["exchange"])
          }
        >
          <option value="ALL">Exchange: All</option>
          <option value="NYSE">NYSE</option>
          <option value="NASDAQ">NASDAQ</option>
          <option value="TSX">TSX</option>
        </select>

        <select
          aria-label="Filter by sector"
          className={selectCls}
          value={filter.sector}
          onChange={(e) => set("sector", e.target.value)}
        >
          <option value="ALL">Sector: All</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by country"
          className={selectCls}
          value={filter.country}
          onChange={(e) =>
            set("country", e.target.value as HoldingsFilter["country"])
          }
        >
          <option value="ALL">Country: All</option>
          <option value="US">United States</option>
          <option value="CA">Canada</option>
        </select>

        {isDirty && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTER)}
            className="flex items-center gap-1 text-xs font-bold text-fg-muted transition-colors hover:text-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
