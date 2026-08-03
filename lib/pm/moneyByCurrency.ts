// Currency-tagged money totals for PM aggregates.
//
// THE PROBLEM THIS SOLVES. The PM ledger stores unit-less integer cents. When a
// route sums across properties that book in different currencies, the result is
// meaningless — 47,858,943 CAD-cents + 43,272,514 USD-cents is not a number
// anyone can label. The fix is to never collapse a mixed total server-side:
// aggregate into a per-currency bucket and let the client, which owns the live
// FX table and the user's display choice, convert and sum at render time.
//
// Server routes build a MoneyByCurrency; clients call `convertTotals` (or the
// <MoneyTotal> component) to get one displayable number.
// Refs: lib/pm/currency.ts, components/pm/PmCurrencyProvider.tsx.
import { convertCents } from "./currency";
import type { FxRates } from "@/lib/utils/convertCurrency";
import type { PmCurrency } from "@/types/pm";

/** Integer cents bucketed by the currency they are denominated in. */
export type MoneyByCurrency = Partial<Record<PmCurrency, number>>;

/** Accumulate `cents` into the bucket for `currency`. Mutates and returns. */
export function addMoney(
  acc: MoneyByCurrency,
  currency: PmCurrency,
  cents: number,
): MoneyByCurrency {
  if (!Number.isFinite(cents)) return acc;
  acc[currency] = (acc[currency] ?? 0) + cents;
  return acc;
}

/** Merge b into a, returning a new bucket. */
export function mergeMoney(
  a: MoneyByCurrency,
  b: MoneyByCurrency,
): MoneyByCurrency {
  const out: MoneyByCurrency = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const key = k as PmCurrency;
    out[key] = (out[key] ?? 0) + (v ?? 0);
  }
  return out;
}

/**
 * Convert every bucket into `display` and sum — the only correct way to turn a
 * mixed-currency total into one number. Returns integer cents.
 *
 * `convertCents` fails soft on a cold FX table, so this degrades to the raw sum
 * rather than NaN; pair it with `isMixed` if you need to warn the user.
 */
export function convertTotals(
  totals: MoneyByCurrency | null | undefined,
  display: PmCurrency,
  rates: FxRates,
): number {
  if (!totals) return 0;
  let sum = 0;
  for (const [k, v] of Object.entries(totals)) {
    if (v == null) continue;
    sum += convertCents(v, k as PmCurrency, display, rates);
  }
  return sum;
}

/** True when more than one currency contributed a non-zero amount — i.e. the
 *  figure genuinely depends on the FX rate being available. */
export function isMixed(totals: MoneyByCurrency | null | undefined): boolean {
  if (!totals) return false;
  return Object.values(totals).filter((v) => (v ?? 0) !== 0).length > 1;
}
