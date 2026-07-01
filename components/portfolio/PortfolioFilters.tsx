"use client";

// Holdings toolbar (PDR §5.3). Single-row layout: search, exchange pills,
// and a Columns popover that exposes the optional table columns plus the
// secondary sector / country / clear controls. Counts come from the
// unfiltered row set so the pills always show the user's actual exchange
// distribution.
import * as React from "react";
import { Search, RotateCcw, Columns3, Check, Building2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Sentinel filter values for the "Held by" company filter. */
export const COMPANY_ALL = "ALL";
export const COMPANY_UNASSIGNED = "UNASSIGNED";

export interface HoldingsFilter {
  query: string;
  exchange: "ALL" | "NYSE" | "NASDAQ" | "TSX";
  sector: string; // "ALL" or a sector name
  country: "ALL" | "US" | "CA";
  /** Held-by company scope: COMPANY_ALL, COMPANY_UNASSIGNED, or a company id. */
  company: string;
}

export const DEFAULT_FILTER: HoldingsFilter = {
  query: "",
  exchange: "ALL",
  sector: "ALL",
  country: "ALL",
  company: COMPANY_ALL,
};

/** A "held-by" company that owns at least one holding. */
export interface CompanyOption {
  id: string;
  name: string;
}

/** Optional columns the user can re-enable through the Columns popover. */
export type OptionalColumn = "sector" | "livePrice" | "currency";

export const DEFAULT_OPTIONAL_COLUMNS: Record<OptionalColumn, boolean> = {
  sector: false,
  livePrice: false,
  currency: false,
};

const EXCHANGE_PILLS: { id: HoldingsFilter["exchange"]; label: string }[] = [
  { id: "ALL", label: "All exchanges" },
  { id: "NASDAQ", label: "NASDAQ" },
  { id: "NYSE", label: "NYSE" },
  { id: "TSX", label: "TSX" },
];

const OPTIONAL_COLUMN_LABELS: Record<OptionalColumn, string> = {
  sector: "Sector",
  livePrice: "Live price",
  currency: "Currency",
};

const selectCls =
  "h-8 w-full rounded border border-border bg-surface px-2 text-xs text-fg focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary";

export function PortfolioFilters({
  filter,
  onChange,
  sectors,
  companies,
  hasUnassigned,
  exchangeCounts,
  optionalColumns,
  onOptionalColumnsChange,
}: {
  filter: HoldingsFilter;
  onChange: (next: HoldingsFilter) => void;
  sectors: string[];
  /** Companies that own at least one holding, for the "Held by" filter. */
  companies: CompanyOption[];
  /** Whether any holding has no held-by company (adds an "Unassigned" option). */
  hasUnassigned: boolean;
  /** Live exchange row counts (computed from unfiltered rows). */
  exchangeCounts: Record<"NYSE" | "NASDAQ" | "TSX", number>;
  optionalColumns: Record<OptionalColumn, boolean>;
  onOptionalColumnsChange: (next: Record<OptionalColumn, boolean>) => void;
}) {
  const set = <K extends keyof HoldingsFilter>(
    key: K,
    value: HoldingsFilter[K],
  ) => onChange({ ...filter, [key]: value });

  const isDirty =
    filter.query !== "" ||
    filter.exchange !== "ALL" ||
    filter.sector !== "ALL" ||
    filter.country !== "ALL" ||
    filter.company !== COMPANY_ALL;

  const totalCount =
    exchangeCounts.NYSE + exchangeCounts.NASDAQ + exchangeCounts.TSX;
  const countFor = (id: HoldingsFilter["exchange"]) =>
    id === "ALL" ? totalCount : exchangeCounts[id];

  // The company filter scopes the whole portfolio (all sections + the stat
  // cards), so it renders whenever any company exists — even when the current
  // scope has no equities and the exchange controls below are hidden.
  const showCompanyFilter = companies.length > 0;
  const showEquityControls = totalCount > 0;

  const [columnsOpen, setColumnsOpen] = React.useState(false);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!columnsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setColumnsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColumnsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [columnsOpen]);

  const toggleColumn = (key: OptionalColumn) =>
    onOptionalColumnsChange({
      ...optionalColumns,
      [key]: !optionalColumns[key],
    });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-[6px]">
      {/* Held by (company) — scopes the whole portfolio, including the stat
          cards above. Always available so the scope can be cleared. */}
      {showCompanyFilter && (
        <label className="relative">
          <Building2 className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <select
            aria-label="Filter by held-by company"
            value={filter.company}
            onChange={(e) => set("company", e.target.value)}
            className={cn(
              "h-9 rounded border pl-8 pr-7 text-xs font-semibold text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
              filter.company !== COMPANY_ALL
                ? "border-primary bg-secondary-container text-primary"
                : "border-border bg-surface",
            )}
          >
            <option value={COMPANY_ALL}>All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {hasUnassigned && (
              <option value={COMPANY_UNASSIGNED}>Unassigned</option>
            )}
          </select>
        </label>
      )}

      {/* Search */}
      {showEquityControls && (
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            value={filter.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder="Search ticker or name…"
            className="h-9 w-full rounded border border-border bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted/60 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>
      )}

      {/* Exchange pills */}
      {showEquityControls && (
        <div className="flex flex-wrap items-center gap-1">
          {EXCHANGE_PILLS.map((p) => {
            const active = filter.exchange === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => set("exchange", p.id)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-[6px] rounded px-3 py-[6px] text-[12px] font-semibold transition-colors",
                  active
                    ? "bg-secondary-container text-primary"
                    : "text-fg-muted hover:bg-surface-low hover:text-fg",
                )}
              >
                {p.label}
                <span
                  className={cn(
                    "rounded px-[6px] py-[1px] text-[10.5px] font-bold tabular-nums",
                    active
                      ? "bg-surface text-primary"
                      : "bg-surface-low text-fg-muted",
                  )}
                >
                  {countFor(p.id)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Columns popover — right-aligned */}
      <div ref={popoverRef} className="relative ml-auto">
        <button
          type="button"
          onClick={() => setColumnsOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={columnsOpen}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded border px-3 text-xs font-semibold transition-colors",
            columnsOpen
              ? "border-primary bg-secondary-container text-primary"
              : "border-border bg-surface text-fg-muted hover:text-fg",
          )}
        >
          <Columns3 className="h-3.5 w-3.5" />
          Columns
        </button>

        {columnsOpen && (
          <div
            role="dialog"
            aria-label="Table options"
            className="absolute right-0 z-50 mt-2 w-72 rounded-md border border-border bg-surface-high p-3 shadow-sm animate-fade-in"
          >
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
              Optional columns
            </p>
            <div className="mb-3 flex flex-col gap-1">
              {(Object.keys(OPTIONAL_COLUMN_LABELS) as OptionalColumn[]).map(
                (key) => {
                  const checked = optionalColumns[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      onClick={() => toggleColumn(key)}
                      className="flex items-center justify-between rounded px-2 py-[7px] text-sm text-fg transition-colors hover:bg-surface-low"
                    >
                      <span>{OPTIONAL_COLUMN_LABELS[key]}</span>
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded border",
                          checked
                            ? "border-primary bg-primary text-on-primary"
                            : "border-border bg-surface",
                        )}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                },
              )}
            </div>

            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
                Filters
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-medium text-fg-muted">
                  Sector
                  <select
                    aria-label="Filter by sector"
                    className={cn(selectCls, "mt-1")}
                    value={filter.sector}
                    onChange={(e) => set("sector", e.target.value)}
                  >
                    <option value="ALL">All sectors</option>
                    {sectors.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-[11px] font-medium text-fg-muted">
                  Country
                  <select
                    aria-label="Filter by country"
                    className={cn(selectCls, "mt-1")}
                    value={filter.country}
                    onChange={(e) =>
                      set(
                        "country",
                        e.target.value as HoldingsFilter["country"],
                      )
                    }
                  >
                    <option value="ALL">All countries</option>
                    <option value="US">United States</option>
                    <option value="CA">Canada</option>
                  </select>
                </label>
              </div>

              {isDirty && (
                <button
                  type="button"
                  onClick={() => onChange(DEFAULT_FILTER)}
                  className="mt-3 flex items-center gap-1 text-xs font-bold text-fg-muted transition-colors hover:text-primary"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
