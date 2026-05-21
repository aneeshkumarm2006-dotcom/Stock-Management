// USD formatting helpers (BR-AC-12, BR-CX-5). All persisted accounting amounts
// are integer cents — see [JournalEntry.ts] / [Deposit.ts] file headers — so
// every formatter here takes `cents` (a JavaScript number) and converts to
// dollars on the way out. Client forms enter dollars and the API multiplies
// by 100 (see toCents below).
//
// Negative amounts render as `($X.XX)` in red per Buildium parity.

const FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Convert an integer cents amount to a display string. */
export function formatUsd(cents: number): string {
  if (!Number.isFinite(cents)) return '$0.00';
  const dollars = cents / 100;
  if (cents < 0) {
    // Render parenthesised, drop the leading minus sign + dollar sign once.
    const positive = FORMATTER.format(Math.abs(dollars));
    return `(${positive})`;
  }
  return FORMATTER.format(dollars);
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
