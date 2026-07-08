"use client";

// Portfolio page (PDR §5.1, §5.3, §11). Full holdings management: the four
// performance stat cards, the searchable/filterable/sortable holdings table,
// and the slide-in Add / Edit panels + delete confirmation. Layout follows
// site/design/portfolio; currency reflows reactively via the Settings store
// (TopBar USD/CAD toggle, Stage 6). Data + mutations come from usePortfolio.
import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  usePortfolio,
  type PortfolioRow,
} from "@/lib/hooks/usePortfolio";
import type { Currency } from "@/lib/utils/convertCurrency";
import { useUiStore } from "@/store/useUiStore";
import { Button } from "@/components/ui/button";
import {
  StatStripSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import { EmptyPortfolio } from "@/components/dashboard/EmptyPortfolio";
import {
  PortfolioStatCards,
  type StatCardSummary,
} from "@/components/portfolio/PortfolioStatCards";
import {
  PortfolioFilters,
  DEFAULT_FILTER,
  DEFAULT_OPTIONAL_COLUMNS,
  COMPANY_ALL,
  COMPANY_UNASSIGNED,
  BROKER_ALL,
  BROKER_UNASSIGNED,
  type HoldingsFilter,
  type OptionalColumn,
  type CompanyOption,
} from "@/components/portfolio/PortfolioFilters";
import { HoldingsTable } from "@/components/portfolio/HoldingsTable";
import { FixedIncomeTable } from "@/components/portfolio/FixedIncomeTable";
import { ManualHoldingsTable } from "@/components/portfolio/ManualHoldingsTable";
import { UpdateValueDialog } from "@/components/portfolio/UpdateValueDialog";
import { DeletePositionDialog } from "@/components/portfolio/DeletePositionDialog";
import { AddHoldingPanel } from "@/components/panels/add/AddHoldingPanel";
import { EditHoldingPanel } from "@/components/panels/EditHoldingPanel";
import { PageHead } from "@/components/layout/PageHead";

/**
 * Recompute the four stat-card aggregates from a subset of holdings. Each row's
 * `metrics` is already in the display currency (computePortfolio, PDR §9), so
 * scoping is a straight sum — no FX or re-derivation needed. Mirrors the totals
 * math in computePortfolio so a single-company view matches the whole-portfolio
 * numbers exactly.
 */
function summarizeRows(
  rows: PortfolioRow[],
  displayCurrency: Currency,
): StatCardSummary {
  const totalValue = rows.reduce((s, r) => s + r.metrics.currentValue, 0);
  const totalInvested = rows.reduce((s, r) => s + r.metrics.invested, 0);
  const totalPnl = totalValue - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  return { totalValue, totalInvested, totalPnl, totalPnlPct, displayCurrency };
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <h2 className="font-display text-sm font-bold uppercase tracking-wider text-fg">
        {title}
      </h2>
      <span className="text-xs text-fg-muted">
        {count} {count === 1 ? "holding" : "holdings"}
      </span>
    </div>
  );
}

function PortfolioError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border bg-surface-high px-6 py-20 text-center">
      <p className="text-sm font-semibold text-fg">
        Couldn&apos;t load your holdings
      </p>
      <p className="mt-1 max-w-sm text-xs text-fg-muted">{message}</p>
      <Button variant="secondary" className="mt-5" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

export default function PortfolioPage() {
  const {
    rows,
    summary,
    sectors,
    displayCurrency,
    hasPositions,
    isLoadingPositions,
    positionsError,
    isFetchingQuotes,
    hasStaleQuotes,
    refetch,
  } = usePortfolio();

  const openAddPanel = useUiStore((s) => s.openAddPanel);
  const [filter, setFilter] = useState<HoldingsFilter>(DEFAULT_FILTER);
  // How the equities (stocks) table is sectioned: a flat table, or one section
  // per broker / issuing company / held-by entity. "Split by broker and by
  // company" for stocks lives here.
  const [equityGroupBy, setEquityGroupBy] = useState<
    "none" | "broker" | "issuer" | "heldBy"
  >("none");
  const [optionalColumns, setOptionalColumns] =
    useState<Record<OptionalColumn, boolean>>(DEFAULT_OPTIONAL_COLUMNS);
  const [toDelete, setToDelete] = useState<PortfolioRow | null>(null);
  const [toUpdateValue, setToUpdateValue] = useState<PortfolioRow | null>(null);

  // The distinct "held-by" companies that own at least one holding, plus
  // whether any holding is unassigned. Derived from the *full* row set so the
  // filter always lists every company regardless of the current scope.
  const companies = useMemo<CompanyOption[]>(() => {
    const byId = new Map<string, string>();
    for (const r of rows) {
      if (r.companyId) byId.set(r.companyId, r.companyName ?? "Unnamed company");
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [rows]);

  const hasUnassigned = useMemo(() => rows.some((r) => !r.companyId), [rows]);

  // The distinct brokers that hold at least one holding (for the broker scope).
  const brokers = useMemo<CompanyOption[]>(() => {
    const byId = new Map<string, string>();
    for (const r of rows) {
      if (r.brokerId) byId.set(r.brokerId, r.brokerName ?? "Unnamed broker");
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [rows]);

  const hasUnassignedBroker = useMemo(
    () => rows.some((r) => !r.brokerId),
    [rows],
  );

  // Company + broker scopes both apply portfolio-wide and compose: they filter
  // every section AND drive the recomputed stat cards below (PDR §5.3 metrics
  // reflect the scope).
  const scopedRows = useMemo(() => {
    let r = rows;
    if (filter.company === COMPANY_UNASSIGNED) r = r.filter((x) => !x.companyId);
    else if (filter.company !== COMPANY_ALL)
      r = r.filter((x) => x.companyId === filter.company);
    if (filter.broker === BROKER_UNASSIGNED) r = r.filter((x) => !x.brokerId);
    else if (filter.broker !== BROKER_ALL)
      r = r.filter((x) => x.brokerId === filter.broker);
    return r;
  }, [rows, filter.company, filter.broker]);

  const selectedCompanyName =
    filter.company === COMPANY_ALL
      ? null
      : filter.company === COMPANY_UNASSIGNED
        ? "Unassigned"
        : (companies.find((c) => c.id === filter.company)?.name ?? "Company");

  // Stat cards reflect the company scope: whole-portfolio totals by default,
  // recomputed subtotals when a company is selected.
  const scopedSummary = useMemo<StatCardSummary | null>(() => {
    if (!summary) return null;
    if (filter.company === COMPANY_ALL && filter.broker === BROKER_ALL)
      return summary;
    return summarizeRows(scopedRows, displayCurrency);
  }, [summary, filter.company, filter.broker, scopedRows, displayCurrency]);

  // Split scoped holdings into per-type sections. Equities keep the filterable
  // table; the rest get type-appropriate section tables.
  const equityRows = useMemo(
    () => scopedRows.filter((r) => (r.assetType ?? "EQUITY") === "EQUITY"),
    [scopedRows],
  );
  const fixedIncomeRows = useMemo(
    () =>
      scopedRows.filter((r) => r.assetType === "GIC" || r.assetType === "BOND"),
    [scopedRows],
  );
  const mutualFundRows = useMemo(
    () => scopedRows.filter((r) => r.assetType === "MUTUAL_FUND"),
    [scopedRows],
  );
  const cashRows = useMemo(
    () => scopedRows.filter((r) => r.assetType === "CASH"),
    [scopedRows],
  );

  // Filters apply to the equities section only.
  const filtered = useMemo(() => {
    const q = filter.query.trim().toLowerCase();
    return equityRows.filter((r) => {
      if (filter.exchange !== "ALL" && r.exchange !== filter.exchange)
        return false;
      if (filter.country !== "ALL" && r.country !== filter.country)
        return false;
      if (
        filter.sector !== "ALL" &&
        (r.sector?.trim() ?? "") !== filter.sector
      )
        return false;
      if (q) {
        const hay = `${r.ticker} ${r.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [equityRows, filter]);

  // Per-exchange counts for the filter pills — derived from the unfiltered
  // equity rows so the pills always reflect the user's true distribution.
  const exchangeCounts = useMemo(() => {
    const counts: Record<string, number> = { NYSE: 0, NASDAQ: 0, TSX: 0 };
    for (const r of equityRows)
      counts[r.exchange] = (counts[r.exchange] ?? 0) + 1;
    return counts;
  }, [equityRows]);

  const distinctExchanges = (["NASDAQ", "NYSE", "TSX"] as const).filter(
    (id) => (exchangeCounts[id] ?? 0) > 0,
  ).length;

  // Section the (filtered) equities by the chosen dimension. "issuer" buckets
  // by ticker so multiple lots of the same company (e.g. AAPL held at two
  // brokers) group together; "broker"/"heldBy" bucket by their entity, with an
  // unassigned bucket sorted last.
  const equityGroups = useMemo<
    Array<{ key: string; label: string; rows: PortfolioRow[] }>
  >(() => {
    if (equityGroupBy === "none") {
      return [{ key: "all", label: "", rows: filtered }];
    }
    const keyed = (r: PortfolioRow): { key: string; label: string } => {
      if (equityGroupBy === "broker") {
        return r.brokerId
          ? { key: r.brokerId, label: r.brokerName ?? "Unnamed broker" }
          : { key: "__none", label: "No broker" };
      }
      if (equityGroupBy === "heldBy") {
        return r.companyId
          ? { key: r.companyId, label: r.companyName ?? "Unnamed company" }
          : { key: "__none", label: "Unassigned" };
      }
      // issuer
      return {
        key: `t:${r.ticker}`,
        label: r.name ? `${r.ticker} · ${r.name}` : r.ticker,
      };
    };
    const m = new Map<string, { label: string; rows: PortfolioRow[] }>();
    for (const r of filtered) {
      const { key, label } = keyed(r);
      const g = m.get(key) ?? { label, rows: [] };
      g.rows.push(r);
      m.set(key, g);
    }
    return Array.from(m.entries())
      .map(([key, v]) => ({ key, label: v.label, rows: v.rows }))
      .sort((a, b) => {
        if (a.key === "__none") return 1;
        if (b.key === "__none") return -1;
        return a.label.localeCompare(b.label);
      });
  }, [equityGroupBy, filtered]);

  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Portfolio"
        subtitle={
          rows.length === 0
            ? "Filter, sort, edit, and value every position in your portfolio"
            : selectedCompanyName
              ? `Held by ${selectedCompanyName} · ${scopedRows.length} of ${rows.length} ${rows.length === 1 ? "holding" : "holdings"}`
              : `${rows.length} active ${rows.length === 1 ? "holding" : "holdings"}${distinctExchanges > 0 ? ` · across ${distinctExchanges} ${distinctExchanges === 1 ? "exchange" : "exchanges"}` : ""}`
        }
        actions={
          <Button onClick={() => openAddPanel()}>
            <Plus className="h-[13px] w-[13px]" />
            Add holding
          </Button>
        }
      />

      {positionsError ? (
        <PortfolioError
          message={positionsError.message}
          onRetry={refetch}
        />
      ) : isLoadingPositions ? (
        <>
          <StatStripSkeleton count={4} />
          <TableSkeleton rows={6} columns={8} />
        </>
      ) : !hasPositions || !summary ? (
        <EmptyPortfolio />
      ) : (
        <>
          {(isFetchingQuotes || hasStaleQuotes) && (
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
              {isFetchingQuotes ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Fetching live prices — values are provisional
                </>
              ) : (
                <>Showing last cached prices for some holdings</>
              )}
            </p>
          )}

          <PortfolioStatCards summary={scopedSummary ?? summary} />

          {/* Filters toolbar — the "Held by" company scope lives here and stays
              reachable even when the scoped view has no equities, so it renders
              outside the equities block below. */}
          <PortfolioFilters
            filter={filter}
            onChange={setFilter}
            sectors={sectors}
            companies={companies}
            hasUnassigned={hasUnassigned}
            brokers={brokers}
            hasUnassignedBroker={hasUnassignedBroker}
            exchangeCounts={exchangeCounts}
            optionalColumns={optionalColumns}
            onOptionalColumnsChange={setOptionalColumns}
          />

          {/* Equities — the filterable/sortable table, optionally split into
              sections by broker / issuing company / held-by entity. */}
          {equityRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-fg-muted">
                  Split stocks by
                </span>
                {(
                  [
                    ["none", "None"],
                    ["broker", "Broker"],
                    ["issuer", "Company"],
                    ["heldBy", "Held-by entity"],
                  ] as Array<[typeof equityGroupBy, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEquityGroupBy(value)}
                    className={
                      "rounded-full border px-3 py-1 text-xs font-bold transition-colors " +
                      (equityGroupBy === value
                        ? "border-primary bg-primary text-primary-fg"
                        : "border-border bg-surface text-fg-muted hover:text-fg")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>

              {equityGroupBy === "none" ? (
                <HoldingsTable
                  rows={filtered}
                  totalRowCount={equityRows.length}
                  displayCurrency={displayCurrency}
                  optionalColumns={optionalColumns}
                  onDelete={setToDelete}
                />
              ) : (
                equityGroups.map((g) => (
                  <div key={g.key} className="space-y-2">
                    <SectionHeading title={g.label} count={g.rows.length} />
                    <HoldingsTable
                      rows={g.rows}
                      totalRowCount={g.rows.length}
                      displayCurrency={displayCurrency}
                      optionalColumns={optionalColumns}
                      onDelete={setToDelete}
                    />
                  </div>
                ))
              )}
            </div>
          )}

          {/* Nothing matches the current company scope. */}
          {scopedRows.length === 0 && (
            <div className="rounded-md border border-border bg-surface px-6 py-16 text-center">
              <p className="text-sm font-semibold text-fg">
                No holdings held by {selectedCompanyName}
              </p>
              <button
                type="button"
                onClick={() => setFilter({ ...filter, company: COMPANY_ALL })}
                className="mt-2 text-xs font-bold text-primary hover:underline"
              >
                Show all companies
              </button>
            </div>
          )}

          {/* Fixed income — GICs & Bonds. */}
          {fixedIncomeRows.length > 0 && (
            <>
              <SectionHeading title="Fixed income" count={fixedIncomeRows.length} />
              <FixedIncomeTable
                rows={fixedIncomeRows}
                displayCurrency={displayCurrency}
                onDelete={setToDelete}
              />
            </>
          )}

          {/* Private mutual funds — manual monthly value. */}
          {mutualFundRows.length > 0 && (
            <>
              <SectionHeading title="Mutual funds" count={mutualFundRows.length} />
              <ManualHoldingsTable
                rows={mutualFundRows}
                displayCurrency={displayCurrency}
                variant="MUTUAL_FUND"
                onDelete={setToDelete}
                onUpdateValue={setToUpdateValue}
              />
            </>
          )}

          {/* Cash & other manual holdings. */}
          {cashRows.length > 0 && (
            <>
              <SectionHeading title="Cash & other" count={cashRows.length} />
              <ManualHoldingsTable
                rows={cashRows}
                displayCurrency={displayCurrency}
                variant="CASH"
                onDelete={setToDelete}
              />
            </>
          )}
        </>
      )}

      {/* Slide-in panels + dialogs (mounted once). */}
      <AddHoldingPanel />
      <EditHoldingPanel rows={rows} />
      <DeletePositionDialog row={toDelete} onClose={() => setToDelete(null)} />
      <UpdateValueDialog
        row={toUpdateValue}
        onClose={() => setToUpdateValue(null)}
      />
    </div>
  );
}
