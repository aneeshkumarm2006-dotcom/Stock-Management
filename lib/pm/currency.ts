// USD formatting helpers (BR-AC-12, BR-CX-5). All persisted accounting amounts
// are integer cents — see [JournalEntry.ts] / [Deposit.ts] file headers — so
// every formatter here takes `cents` (a JavaScript number) and converts to
// dollars on the way out. Client forms enter dollars and the API multiplies
// by 100 (see toCents below).
//
// Negative amounts render as `($X.XX)` in red per Buildium parity.

// Lazily-built, cached Intl formatters keyed by ISO-4217 code. Building an
// Intl.NumberFormat is comparatively expensive, so we memoize one per currency.
const FORMATTERS: Record<string, Intl.NumberFormat> = {};

function formatterFor(currency: string): Intl.NumberFormat {
  const key = currency.toUpperCase();
  if (!FORMATTERS[key]) {
    FORMATTERS[key] = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: key,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return FORMATTERS[key];
}

/**
 * Convert an integer cents amount to a display string in the given currency.
 * Currency-agnostic: cents are unit-less 2-decimal integers, so the only thing
 * that varies is the rendered symbol (USD → `$`, CAD → `CA$`). Negatives render
 * parenthesised per Buildium parity. Change §0A.
 */
export function formatMoney(cents: number, currency: string = 'USD'): string {
  const fmt = formatterFor(currency);
  if (!Number.isFinite(cents)) return fmt.format(0);
  const dollars = cents / 100;
  if (cents < 0) {
    // Render parenthesised, drop the leading minus sign once.
    return `(${fmt.format(Math.abs(dollars))})`;
  }
  return fmt.format(dollars);
}

/** Convert an integer cents amount to a USD display string. Thin wrapper over
 * `formatMoney` kept so existing USD call sites don't change behavior. */
export function formatUsd(cents: number): string {
  return formatMoney(cents, 'USD');
}

/** Tailwind class for negative amounts (red), empty string otherwise.
 * Pair with the value returned from `formatUsd`. */
export function usdClassName(cents: number): string {
  return cents < 0 ? 'text-red-600' : '';
}

/** Convert a decimal-dollar amount from a client form to integer cents.
 * Accepts string or number; rounds at the half-cent to avoid float drift. */
export function toCents(dollars: number | string): number {
  const n = typeof dollars === 'string' ? Number(dollars) : dollars;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Inverse of `toCents` for client-side display when a JSON payload comes
 * back from the API in cents. */
export function fromCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return cents / 100;
}

/** Parse a free-text currency input (e.g. "1,234.56", "$1234.56", "1.005")
 * into a clean dollar number. Strips a leading "$", thousands commas and
 * surrounding whitespace, then rounds to whole cents so sub-cent precision
 * ("1.005" → 1.01) cannot leak through. Returns `null` for empty or
 * non-numeric input so callers can REJECT rather than coerce to NaN.
 *
 * Note: returns DOLLARS (not cents). The API routes still call `toCents`,
 * so callers must send the dollar value this returns — do not multiply by
 * 100 on the client. */
export function parseCurrencyToDollars(input: string | number): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) / 100 : null;
  }
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}
