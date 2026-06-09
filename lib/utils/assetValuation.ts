// Pure valuation for non-equity holdings (GIC / Bond / Mutual fund / Cash).
// Equities keep their live-quote path in portfolioMath.ts; this module covers
// the manually- or formula-valued types. Everything here is in the holding's
// NATIVE currency — FX conversion to the display currency happens at the call
// site via toDisplayCurrency (kept out of here so the math stays I/O-free and
// trivially unit-testable). Refs: plan §2.
import type { AssetType, PayoutFrequency } from '@/lib/db/models/Position';

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Compounding periods per year for a fixed-income payout cadence. */
export function payoutsPerYear(freq: PayoutFrequency | undefined): number {
  switch (freq) {
    case 'MONTHLY':
      return 12;
    case 'QUARTERLY':
      return 4;
    case 'SEMI_ANNUAL':
      return 2;
    case 'ANNUAL':
      return 1;
    case 'AT_MATURITY':
    default:
      return 1;
  }
}

/** Minimal shape the fixed-income formulas need (subset of IPosition). */
export interface FixedIncomeInput {
  principal?: number | null;
  interestRate?: number | null; // annual %, e.g. 4.5
  payoutFrequency?: PayoutFrequency | null;
  startDate?: Date | string | null;
  maturityDate?: Date | string | null;
}

function toTime(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Value at maturity for a GIC/Bond:
 *   principal × (1 + r/n) ^ (n × yearsTotal)
 * where r = interestRate/100 and n = payouts per year. Returns the principal
 * (no growth) if any input is missing or the dates are non-positive.
 */
export function maturityValue(p: FixedIncomeInput): number {
  const principal = Number(p.principal);
  if (!Number.isFinite(principal) || principal <= 0) return principal || 0;
  const r = Number(p.interestRate) / 100;
  const n = payoutsPerYear(p.payoutFrequency ?? undefined);
  const start = toTime(p.startDate);
  const end = toTime(p.maturityDate);
  if (!Number.isFinite(r) || r < 0 || start == null || end == null || end <= start) {
    return principal;
  }
  const yearsTotal = (end - start) / YEAR_MS;
  return principal * Math.pow(1 + r / n, n * yearsTotal);
}

/**
 * Accrued value to today for a GIC/Bond — the same compound formula evaluated
 * at the elapsed fraction of the term, clamped to [0, term]. After maturity it
 * equals the maturity value (does not keep compounding). Used as the holding's
 * current value for portfolio totals.
 */
export function accruedValue(
  p: FixedIncomeInput,
  now: number = Date.now(),
): number {
  const principal = Number(p.principal);
  if (!Number.isFinite(principal) || principal <= 0) return principal || 0;
  const r = Number(p.interestRate) / 100;
  const n = payoutsPerYear(p.payoutFrequency ?? undefined);
  const start = toTime(p.startDate);
  const end = toTime(p.maturityDate);
  if (!Number.isFinite(r) || r < 0 || start == null || end == null || end <= start) {
    return principal;
  }
  const yearsTotal = (end - start) / YEAR_MS;
  const yearsElapsed = Math.max(0, Math.min((now - start) / YEAR_MS, yearsTotal));
  return principal * Math.pow(1 + r / n, n * yearsElapsed);
}

export interface ValuationInput extends FixedIncomeInput {
  assetType: AssetType;
  currency: string;
  costBasis?: number | null;
  currentValue?: number | null;
}

export interface HoldingValuation {
  /** Amount invested / book value, native currency. */
  invested: number;
  /** Current value, native currency. */
  currentValue: number;
  /** Maturity value for fixed income (else equal to currentValue). */
  maturityValue: number;
  currency: string;
}

/**
 * Native-currency valuation for a non-equity holding. EQUITY is not handled
 * here (it flows through portfolioMath with a live quote); passing one returns
 * zeros so callers must branch on assetType themselves.
 */
export function valuateHolding(
  p: ValuationInput,
  now: number = Date.now(),
): HoldingValuation {
  switch (p.assetType) {
    case 'GIC':
    case 'BOND': {
      const invested = Number(p.principal) || 0;
      return {
        invested,
        currentValue: accruedValue(p, now),
        maturityValue: maturityValue(p),
        currency: p.currency,
      };
    }
    case 'MUTUAL_FUND': {
      const invested = Number(p.costBasis) || 0;
      const current = Number(p.currentValue) || 0;
      return {
        invested,
        currentValue: current,
        maturityValue: current,
        currency: p.currency,
      };
    }
    case 'CASH': {
      const current = Number(p.currentValue) || 0;
      // Cash has no cost basis distinct from its value → P&L is zero.
      return {
        invested: current,
        currentValue: current,
        maturityValue: current,
        currency: p.currency,
      };
    }
    default:
      return { invested: 0, currentValue: 0, maturityValue: 0, currency: p.currency };
  }
}

/**
 * A manually-valued holding is "stale" when its value-as-of date falls before
 * the 1st of the current calendar month — i.e. it hasn't been refreshed this
 * month. Drives the red dot on Mutual fund rows. Missing date = stale.
 */
export function isManualValueStale(
  valueAsOf: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!valueAsOf) return true;
  const t = new Date(valueAsOf).getTime();
  if (!Number.isFinite(t)) return true;
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return t < firstOfMonth;
}
