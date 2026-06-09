// Rent-method resolution (changes.md §3). A lease's monthly rent can be entered
// two ways — a `Fixed` flat amount, or a `RatePerSqft` dollar rate multiplied by
// the unit's square footage. Per the §3 decision we STORE the method + rate but
// PERSIST THE RESOLVED `primaryRent.amount`, so no downstream reader (rent roll,
// GL posting, reports) has to learn the formula. This module is the single place
// every write path (POST /leases, PATCH /leases/:id, draft create + execute)
// calls to turn a client-supplied (method, amount, rate, sizeSqft) into the
// integer-cents amount actually written.
import { toCents } from './currency';
import type { RentMethod } from '@/types/pm';

/** Thrown when a `RatePerSqft` lease cannot be resolved (rate ≤ 0 or the unit
 *  has no square footage). Route handlers map this to a 400. */
export class RentResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentResolutionError';
  }
}

export interface ResolveRentInput {
  /** Defaults to `Fixed` when omitted (back-compat). Typed loosely as `string`
   *  so callers can pass a Zod-enum value (`string`) without a cast; only the
   *  exact `'RatePerSqft'` literal selects the per-sqft branch. */
  rentMethod?: string | null;
  /** Fixed-method monthly rent, in dollars (from the client form). */
  amount?: number | null;
  /** Per-sqft rate, in dollars (from the client form). */
  ratePerSqft?: number | null;
  /** Unit size in square feet — required (and must be > 0) for `RatePerSqft`. */
  sizeSqft?: number | null;
}

export interface ResolvedRent {
  /** Normalized method actually stored on the lease. */
  rentMethod: RentMethod;
  /** Resolved monthly rent, in integer cents → `primaryRent.amount`. */
  amountCents: number;
  /** Per-sqft rate in integer cents (0 for `Fixed`) → `ratePerSqftCents`. */
  ratePerSqftCents: number;
}

/** Monthly rent (cents) from an already-cents rate × square footage. Rounds so
 *  a fractional `sizeSqft` can't leak sub-cent precision. Shared by the resolver
 *  and the draft-execute recompute (which already holds `ratePerSqftCents`). */
export function rentCentsFromRateCents(
  ratePerSqftCents: number,
  sizeSqft: number,
): number {
  return Math.round(ratePerSqftCents * sizeSqft);
}

/**
 * Resolve a client-supplied rent into the cents amount + rate to persist.
 * - `Fixed`      → `amountCents = toCents(amount)`, `ratePerSqftCents = 0`.
 * - `RatePerSqft`→ requires `ratePerSqft > 0` and `sizeSqft > 0`; computes
 *                  `amountCents = round(toCents(ratePerSqft) * sizeSqft)`.
 * Throws {@link RentResolutionError} when a per-sqft lease is under-specified.
 */
export function resolveRent(input: ResolveRentInput): ResolvedRent {
  const method: RentMethod =
    input.rentMethod === 'RatePerSqft' ? 'RatePerSqft' : 'Fixed';

  if (method === 'RatePerSqft') {
    const rate = input.ratePerSqft ?? 0;
    if (!(rate > 0)) {
      throw new RentResolutionError(
        'Rent per square foot requires a rate greater than 0.',
      );
    }
    const sqft = input.sizeSqft ?? 0;
    if (!(sqft > 0)) {
      throw new RentResolutionError(
        "This unit has no square footage set, so rent per square foot can't be computed. Set the unit size or use a fixed rent amount.",
      );
    }
    const ratePerSqftCents = toCents(rate);
    return {
      rentMethod: 'RatePerSqft',
      amountCents: rentCentsFromRateCents(ratePerSqftCents, sqft),
      ratePerSqftCents,
    };
  }

  return {
    rentMethod: 'Fixed',
    amountCents: toCents(input.amount ?? 0),
    ratePerSqftCents: 0,
  };
}
