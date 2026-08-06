// Largest-remainder cents distribution.
//
// Splitting one company-level cost (an insurance premium covering every
// building) across that company's properties has to be exact: the shares must
// sum to the source amount to the cent, or the resulting bill's debits won't
// match its credit and the general ledger stops balancing.
//
// There was no penny-allocation helper anywhere in this codebase before this
// file — the only rounding was `Math.round((income * feePercent) / 100)` in
// lib/pm/managementFees.ts. So this is new code, and it is deliberately pure:
// no mongoose, no DB, plain string keys, so scripts/verify-company-allocation.ts
// can assert on it directly. (There is no test runner in this project; that
// script is the substitute and is meant to gate the merge.)

export interface AllocationWeight {
  key: string;
  weight: number;
}

export interface AllocationShare {
  key: string;
  cents: number;
}

/** Drop weights that can't participate: non-finite, negative, or zero. */
export function normalizeWeights(
  weights: AllocationWeight[],
): AllocationWeight[] {
  return weights.filter((w) => Number.isFinite(w.weight) && w.weight > 0);
}

/** Every key carries the same weight — the default basis. */
export function equalWeights(keys: string[]): AllocationWeight[] {
  return keys.map((key) => ({ key, weight: 1 }));
}

/**
 * Split `totalCents` across `weights` so the shares sum EXACTLY to the input.
 *
 * Returns `[]` when no weight survives normalisation — the caller decides the
 * fallback, because "what to do when a company has no eligible properties" is a
 * business question (we post the amount unallocated), not an arithmetic one.
 * This module never guesses.
 *
 * Guarantees:
 *   - `sum(result.cents) === Math.round(totalCents)` for any surviving weights
 *   - `allocateCents(-n, w)` is `allocateCents(n, w)` with every cent negated
 *   - deterministic: same input, same output, including which share gets the
 *     odd penny (remainder DESC → weight DESC → input order ASC, so callers
 *     control the tie-break by ordering the member list)
 *   - input order is preserved in the output
 */
export function allocateCents(
  totalCents: number,
  weights: AllocationWeight[],
): AllocationShare[] {
  if (!Number.isFinite(totalCents)) {
    // A NaN/Infinity premium must never reach the ledger quietly.
    throw new Error("allocateCents: totalCents must be a finite number");
  }
  const total = Math.round(totalCents);

  const usable = normalizeWeights(weights);
  if (usable.length === 0) return [];

  // Uniform shape for a zero total keeps the caller's merge branch-free.
  if (total === 0) return usable.map((w) => ({ key: w.key, cents: 0 }));

  // Work on the magnitude and re-apply the sign at the end. Math.floor on a
  // negative biases the remainder the wrong way, which would make a credit
  // note split differently from the debit it reverses.
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const weightTotal = usable.reduce((s, w) => s + w.weight, 0);

  // Divide before multiplying: `abs * weight` can exceed 2^53 when a large
  // amount meets a large weight (square footage, unit counts).
  const exact = usable.map((w) => abs * (w.weight / weightTotal));
  const base = exact.map((v) => Math.floor(v));
  const remainder = exact.map((v, i) => v - base[i]!);

  // Integer, and in [0, n). Absorbs any float drift from the division above.
  let leftover = abs - base.reduce((s, v) => s + v, 0);

  const order = usable
    .map((w, i) => ({ i, weight: w.weight, rem: remainder[i]! }))
    .sort((a, b) => b.rem - a.rem || b.weight - a.weight || a.i - b.i);

  const out = base.slice();
  for (const entry of order) {
    if (leftover <= 0) break;
    out[entry.i] = out[entry.i]! + 1;
    leftover -= 1;
  }

  const shares = usable.map((w, i) => ({ key: w.key, cents: sign * out[i]! }));

  if (process.env.NODE_ENV !== "production") {
    const sum = shares.reduce((s, x) => s + x.cents, 0);
    if (sum !== total) {
      throw new Error(
        `allocateCents: shares sum to ${sum} but total is ${total}`,
      );
    }
  }

  return shares;
}

/** Convenience wrapper for callers that want lookup rather than iteration. */
export function allocateToMap(
  totalCents: number,
  weights: AllocationWeight[],
): Map<string, number> {
  return new Map(
    allocateCents(totalCents, weights).map((s) => [s.key, s.cents]),
  );
}
