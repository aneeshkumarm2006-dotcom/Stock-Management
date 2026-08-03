"use client";

// PM currency context — the single place the properties workspace learns
// (a) which currency to render in, (b) the live FX table, and (c) what the
// amounts it is being handed are natively denominated in.
//
// WHY A CONTEXT. There are ~170 money render sites across /properties. Passing
// a `currency` prop to each is unmaintainable and guarantees drift (the module
// already proved this: 95 of 112 CurrencyAmount call sites silently rendered
// USD). Instead a page declares its native currency ONCE with
// <PmNativeCurrency>, and every CurrencyAmount beneath it converts correctly
// with no per-call-site change.
//
// Nesting is meaningful: a property-scoped section can override the org-level
// default, so a list of mixed-currency properties wraps each row in its own
// scope. Refs: lib/pm/currency.ts (resolver + convertCents).
import * as React from "react";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useFxSync } from "@/lib/hooks/useDashboard";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { convertCents } from "@/lib/pm/currency";
import type { FxRates } from "@/lib/utils/convertCurrency";
import type { PmCurrency } from "@/types/pm";

interface PmCurrencyContextValue {
  /** What the user has selected in the top bar. */
  displayCurrency: PmCurrency;
  /** Org-level fallback for amounts with no property scope. */
  orgDefaultCurrency: PmCurrency;
  /** Native currency of amounts in the current subtree. */
  nativeCurrency: PmCurrency;
  rates: FxRates;
  /** True once the FX table has loaded a rate for the display currency. */
  ratesReady: boolean;
  /** Native cents → display-currency cents. */
  convert: (cents: number, native?: PmCurrency) => number;
}

const PmCurrencyContext = React.createContext<PmCurrencyContextValue | null>(
  null,
);

function isPmCurrency(v: unknown): v is PmCurrency {
  return v === "USD" || v === "CAD";
}

/**
 * Mount once per PM page tree (see app/(dashboard)/properties/layout.tsx).
 * Fetches the org's default currency and keeps the shared FX table warm.
 */
export function PmCurrencyProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // /properties is reachable without visiting the stock dashboard, which is
  // otherwise the only thing that populates the FX table. Without this,
  // `fxRates` stays at its initial { USD: 1 } and every conversion soft-falls
  // back to the raw amount under the wrong symbol.
  useFxSync();

  const storeCurrency = useSettingsStore((s) => s.displayCurrency);
  const rates = useSettingsStore((s) => s.fxRates);

  const [orgDefaultCurrency, setOrgDefaultCurrency] =
    React.useState<PmCurrency>("USD");

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/organization")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (isPmCurrency(d?.defaultCurrency)) {
          setOrgDefaultCurrency(d.defaultCurrency);
        }
      })
      .catch(() => {
        /* keep the USD fallback — non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The store is typed as a free-string Currency (the stock side supports ~161
  // ISO codes); the PM ledger only books USD/CAD, so anything else falls back
  // to the org currency rather than rendering an unconvertible symbol.
  const displayCurrency: PmCurrency = isPmCurrency(storeCurrency)
    ? storeCurrency
    : orgDefaultCurrency;

  const value = React.useMemo<PmCurrencyContextValue>(() => {
    const ratesReady =
      displayCurrency === "USD" || Number.isFinite(rates?.[displayCurrency]);
    return {
      displayCurrency,
      orgDefaultCurrency,
      nativeCurrency: orgDefaultCurrency,
      rates,
      ratesReady,
      convert: (cents, native) =>
        convertCents(
          cents,
          native ?? orgDefaultCurrency,
          displayCurrency,
          rates,
        ),
    };
  }, [displayCurrency, orgDefaultCurrency, rates]);

  return (
    <PmCurrencyContext.Provider value={value}>
      {children}
    </PmCurrencyContext.Provider>
  );
}

/**
 * Declare the native currency of every amount in this subtree. Wrap a property
 * detail page (or a single row in a mixed list) and nested CurrencyAmounts
 * convert from this currency without any prop threading.
 *
 * `currency={undefined}` is a valid no-op — it keeps the inherited scope, so
 * callers can pass `property.currency` straight through without a guard.
 */
export function PmNativeCurrency({
  currency,
  children,
}: {
  currency: PmCurrency | null | undefined;
  children: React.ReactNode;
}) {
  const parent = React.useContext(PmCurrencyContext);

  const value = React.useMemo<PmCurrencyContextValue | null>(() => {
    if (!parent) return null;
    const native = currency ?? parent.nativeCurrency;
    return {
      ...parent,
      nativeCurrency: native,
      convert: (cents, override) => parent.convert(cents, override ?? native),
    };
  }, [parent, currency]);

  if (!value) return <>{children}</>;
  return (
    <PmCurrencyContext.Provider value={value}>
      {children}
    </PmCurrencyContext.Provider>
  );
}

/**
 * Read the PM currency context. Returns null outside a provider so components
 * shared with the stock workspace keep working — callers must handle null by
 * falling back to their previous behaviour rather than throwing.
 */
export function usePmCurrency(): PmCurrencyContextValue | null {
  return React.useContext(PmCurrencyContext);
}

/**
 * String-returning equivalent of <CurrencyAmount>, for the call sites that need
 * a plain string rather than JSX — dialog copy, option labels, aria-labels,
 * template literals. Converts from the scope's native currency and formats with
 * the user's number-format preference.
 *
 * Prefer <CurrencyAmount> in JSX; it also handles the red-negative styling.
 */
export function usePmMoneyFormatter(): (
  cents: number | null | undefined,
  nativeCurrency?: PmCurrency,
) => string {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const pm = usePmCurrency();

  return React.useCallback(
    (cents, nativeCurrency) => {
      if (cents == null || !Number.isFinite(cents)) return "—";
      const display = pm?.displayCurrency ?? "USD";
      const converted = pm ? pm.convert(cents, nativeCurrency) : cents;
      return formatCurrency(converted / 100, display, {
        format: numberFormat,
        accounting: true,
      });
    },
    [pm, numberFormat],
  );
}

export default PmCurrencyProvider;
