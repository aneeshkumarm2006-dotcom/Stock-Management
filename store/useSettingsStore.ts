// Display preferences mirrored client-side for instant reflow of the
// currency toggle / number format without a round-trip. The server (via
// /api/settings, Settings model) remains the source of truth: pages hydrate
// the store from the server doc on load and persist changes back. The cached
// USD-based FX rate table also lives here so every aggregation can convert
// between any pair of currencies (PDR §9).
// Refs: PDR.md §5.7, §9; lib/db/models/Settings.ts.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Currency, FxRates } from "@/lib/utils/convertCurrency";
import type { NumberFormat } from "@/lib/utils/formatNumber";

export type Theme = "dark" | "light";

interface SettingsState {
  displayCurrency: Currency;
  theme: Theme;
  numberFormat: NumberFormat;
  /** USD-anchored conversion table from the FX cache (1 USD = rates[CCY]).
   *  Defaults to `{ USD: 1 }`; populated once `useFxSync` runs. */
  fxRates: FxRates;
  /** Convenience: cached USD→CAD rate (1 USD = fxUsdToCad CAD). Mirrors
   *  `fxRates.CAD` and stays for callers that haven't migrated yet. */
  fxUsdToCad: number;
  fxFetchedAt: number | null;
  /** True once hydrated from the server Settings doc. */
  hydrated: boolean;

  setDisplayCurrency: (c: Currency) => void;
  toggleDisplayCurrency: () => void;
  setTheme: (t: Theme) => void;
  setNumberFormat: (f: NumberFormat) => void;
  /** Set the full rate table; `fxUsdToCad` is recomputed from `rates.CAD`. */
  setFxRates: (rates: FxRates, fetchedAt?: number) => void;
  /** Replace prefs from the authoritative server Settings doc. */
  hydrateFromServer: (s: {
    defaultCurrency: Currency;
    theme: Theme;
    numberFormat: NumberFormat;
  }) => void;
}

const INITIAL_RATES: FxRates = { USD: 1 };

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      displayCurrency: "USD",
      theme: "light",
      numberFormat: "1,234.56",
      fxRates: INITIAL_RATES,
      fxUsdToCad: 1,
      fxFetchedAt: null,
      hydrated: false,

      setDisplayCurrency: (displayCurrency) => set({ displayCurrency }),
      toggleDisplayCurrency: () =>
        set((s) => ({
          displayCurrency: s.displayCurrency === "USD" ? "CAD" : "USD",
        })),
      setTheme: (theme) => set({ theme }),
      setNumberFormat: (numberFormat) => set({ numberFormat }),
      setFxRates: (rates, fetchedAt = Date.now()) =>
        set({
          fxRates: rates,
          fxUsdToCad:
            typeof rates.CAD === "number" && Number.isFinite(rates.CAD)
              ? rates.CAD
              : 1,
          fxFetchedAt: fetchedAt,
        }),
      hydrateFromServer: (s) =>
        set({
          displayCurrency: s.defaultCurrency,
          theme: s.theme,
          numberFormat: s.numberFormat,
          hydrated: true,
        }),
    }),
    {
      name: "spm-settings",
      storage: createJSONStorage(() => localStorage),
      // FX table + hydration flag are runtime-only; don't persist them.
      partialize: (s) => ({
        displayCurrency: s.displayCurrency,
        theme: s.theme,
        numberFormat: s.numberFormat,
      }),
    },
  ),
);
