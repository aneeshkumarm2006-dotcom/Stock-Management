// Fixed-rate, level-payment loan amortization — the split of a mortgage
// payment into interest (an Operating Expense) and principal (a reduction of a
// Long-term Liability).
//
// PURE BY DESIGN. No mongoose, no `lib/db`, no `Date.now()` — plain numbers in,
// plain numbers out. Same contract as `lib/pm/allocation.ts` and
// `lib/pm/scope.ts`. This project has no test runner, so purity is what lets
// `scripts/verify-amortization.ts` assert on it directly as a merge gate.
//
// THE INVARIANT EVERYTHING ELSE RESTS ON
// --------------------------------------
//   Σ principal over the full term === originalPrincipalCents, exactly,
//   and the closing balance of the final period is exactly 0.
// If that ever fails, the Balance Sheet strands a residue on `Mortgage Payable`
// forever. `verify-amortization.ts` asserts it across a matrix of terms.
//
// WHAT IS DERIVED VS. WHAT IS STORED
// ----------------------------------
// Nothing here mutates. There is deliberately NO `currentBalance` field
// anywhere in the system: a rolled-back period, a duplicate-suppressed period
// or a released claim would each leave a decremented balance permanently wrong
// with nothing able to detect it. The balance is recomputed from the immutable
// loan terms plus a payment index on every single call.
//
// THE PAYMENT IS SACRED; ONLY THE SPLIT IS COMPUTED
// -------------------------------------------------
// The payment total comes from the rule's stored amount — the real figure that
// leaves the bank. A derived annuity payment differs from a lender's by a cent
// or two (different rounding), and posting a Cash credit that doesn't match the
// bank statement would break reconciliation on every payment forever.
// `derivePaymentCents` therefore exists only as a UI sanity check.
import type { RecurringFrequency } from '@/types/pm';

/**
 * How interest compounds relative to the payment period.
 *
 * - `PeriodMatched` (US convention): i = annualRate / periodsPerYear.
 * - `SemiAnnual` (Canadian legal convention): mortgages compound semi-annually,
 *   not in advance, so i = (1 + annualRate/2)^(2/periodsPerYear) − 1.
 *
 * This is not cosmetic. On a 5% $1M 25-year mortgage the two differ by roughly
 * $4 a month and ~$1,300 over the term, and the balances drift apart
 * permanently. It must be confirmed against a lender statement, never guessed.
 */
export type AmortizationCompounding = 'SemiAnnual' | 'PeriodMatched';

export const AMORTIZATION_COMPOUNDING: readonly AmortizationCompounding[] = [
  'SemiAnnual',
  'PeriodMatched',
] as const;

export interface AmortizationTerms {
  /** Original loan amount at origination, integer cents. */
  originalPrincipalCents: number;
  /** Nominal annual rate as a percentage, e.g. 5.25 for 5.25%. */
  annualRatePct: number;
  /** Total number of scheduled payments over the amortization period. */
  termPeriods: number;
  /** 12 for Monthly, 4 for Quarterly, 1 for Yearly. */
  periodsPerYear: number;
  /**
   * The payment that actually leaves the bank, integer cents. Omit only to ask
   * `derivePaymentCents` what it would be.
   */
  paymentCents?: number;
  /** Defaults to `SemiAnnual` — this client's mortgages are Quebec-based. */
  compounding?: AmortizationCompounding;
}

export interface AmortizationPeriod {
  /** 1-based payment number. */
  index: number;
  openingBalanceCents: number;
  interestCents: number;
  principalCents: number;
  /** interest + principal. Equals the stored payment except on the final one. */
  paymentCents: number;
  closingBalanceCents: number;
  isFinal: boolean;
  /**
   * Final-period true-up: `paymentCents − terms.paymentCents`, normally 0.
   * The last payment must clear the balance exactly, so it legitimately differs
   * from the stored amount by a few cents. Callers surface this as a note
   * rather than silently posting a different total.
   */
  adjustedFromScheduledPayment: number;
}

export type AmortizationErrorCode =
  /** interest >= payment: the loan would grow. Never clamped — see below. */
  | 'NEGATIVE_AMORTIZATION'
  /** Asked for a payment beyond the end of the amortization period. */
  | 'PAST_TERM'
  /** The period date precedes origination, so there is no payment number. */
  | 'INDEX_BEFORE_ORIGINATION'
  /** Non-finite / non-positive inputs, or an unsupported frequency. */
  | 'INVALID_TERMS';

export class AmortizationError extends Error {
  readonly code: AmortizationErrorCode;
  constructor(code: AmortizationErrorCode, message: string) {
    super(message);
    this.name = 'AmortizationError';
    this.code = code;
  }
}

/** Payment cadences a level-payment schedule is defined for. */
export const PERIODS_PER_YEAR: Partial<Record<RecurringFrequency, number>> = {
  Monthly: 12,
  Quarterly: 4,
  Yearly: 1,
};

/**
 * Weekly is deliberately absent. Canadian "accelerated bi-weekly" mortgages use
 * payment = monthly/2 with 26 payments a year, which is a different convention
 * that a naive weekly schedule would get silently wrong.
 */
export function periodsPerYearFor(freq: RecurringFrequency): number {
  const n = PERIODS_PER_YEAR[freq];
  if (!n) {
    throw new AmortizationError(
      'INVALID_TERMS',
      `${freq} payments are not supported for a mortgage split. Use Monthly, Quarterly or Yearly.`,
    );
  }
  return n;
}

function assertTerms(t: AmortizationTerms): void {
  const bad = (msg: string) => {
    throw new AmortizationError('INVALID_TERMS', msg);
  };
  if (!Number.isFinite(t.originalPrincipalCents) || t.originalPrincipalCents <= 0) {
    bad('Original principal must be a positive amount.');
  }
  if (!Number.isInteger(t.originalPrincipalCents)) {
    bad('Original principal must be whole cents.');
  }
  if (!Number.isFinite(t.annualRatePct) || t.annualRatePct < 0) {
    bad('Annual rate must be zero or positive.');
  }
  if (!Number.isInteger(t.termPeriods) || t.termPeriods <= 0) {
    bad('Term must be a positive whole number of payments.');
  }
  if (!Number.isFinite(t.periodsPerYear) || t.periodsPerYear <= 0) {
    bad('Periods per year must be positive.');
  }
}

/** The per-period interest rate as a decimal fraction. */
export function periodicRate(t: AmortizationTerms): number {
  assertTerms(t);
  if (t.annualRatePct === 0) return 0;
  const compounding = t.compounding ?? 'SemiAnnual';
  if (compounding === 'PeriodMatched') {
    return t.annualRatePct / 100 / t.periodsPerYear;
  }
  // Semi-annual: convert the semi-annual effective rate to the payment period.
  return Math.pow(1 + t.annualRatePct / 200, 2 / t.periodsPerYear) - 1;
}

/**
 * The level payment that amortizes the loan to exactly zero over the term.
 *
 * Used as a VALIDATOR, not as the posted amount — see the header. A divergence
 * from the entered payment larger than ~1% means one of principal, rate, term
 * or compounding is wrong, and posting on wrong terms is worse than not posting.
 */
export function derivePaymentCents(t: AmortizationTerms): number {
  assertTerms(t);
  const i = periodicRate(t);
  // i === 0 would be 0/0 in the annuity formula. Round UP so the final payment
  // is the small one rather than leaving a residue.
  if (i === 0) return Math.ceil(t.originalPrincipalCents / t.termPeriods);
  const factor = 1 - Math.pow(1 + i, -t.termPeriods);
  // Never return 0: on a very small principal spread over a long term the
  // annuity payment rounds below a cent, and a zero payment amortizes nothing.
  // A cent is the smallest thing the ledger can move.
  return Math.max(1, Math.round((t.originalPrincipalCents * i) / factor));
}

function resolvePayment(t: AmortizationTerms): number {
  const p = t.paymentCents ?? derivePaymentCents(t);
  if (!Number.isFinite(p) || p <= 0) {
    throw new AmortizationError(
      'INVALID_TERMS',
      'Payment must be a positive amount.',
    );
  }
  return Math.round(p);
}

/**
 * One step of the recurrence. Shared by `amortizationSchedule` and
 * `amortizationAt` so the two can never disagree — which matters because the
 * catch-up preview and the live poster call different entry points.
 */
function stepPeriod(
  k: number,
  openingBalance: number,
  i: number,
  payment: number,
  termPeriods: number,
): AmortizationPeriod {
  const interest = Math.round(openingBalance * i);

  // The loan is settled the moment the payment covers the whole remaining
  // balance plus its interest, which can be BEFORE the nominal term when the
  // entered payment exceeds the annuity payment. Repaying more than is owed
  // would drive the liability negative.
  const uncapped = payment - interest;
  const isFinal = k >= termPeriods || uncapped >= openingBalance;

  if (!isFinal && interest >= payment) {
    // NEVER clamp. Clamping principal to 0 hides a data error; letting it go
    // negative would emit a CREDIT to Mortgage Payable, which still balances
    // and would therefore survive every downstream check while quietly growing
    // a liability nobody asked for. It is also structurally unpostable through
    // the Bill path, which cannot represent a credit line.
    throw new AmortizationError(
      'NEGATIVE_AMORTIZATION',
      `Payment ${payment} does not cover interest ${interest} at period ${k}. ` +
        'Check the principal, rate, term and compounding — the loan would grow.',
    );
  }

  // The last payment clears the balance exactly, so it may differ from the
  // stored payment by a few cents. The alternative — keep the payment fixed and
  // let principal absorb the drift — strands a residue on the Balance Sheet
  // forever.
  const principal = isFinal ? openingBalance : uncapped;
  const actualPayment = interest + principal;

  return {
    index: k,
    openingBalanceCents: openingBalance,
    interestCents: interest,
    principalCents: principal,
    paymentCents: actualPayment,
    closingBalanceCents: openingBalance - principal,
    isFinal,
    adjustedFromScheduledPayment: isFinal ? actualPayment - payment : 0,
  };
}

/**
 * The full schedule, period 1 until the balance clears.
 *
 * Integer cents at every step — the balance is never carried as a float, so
 * `Σ principal` lands exactly on the original principal by construction rather
 * than by luck.
 *
 * The result can be SHORTER than `termPeriods` when the entered payment exceeds
 * the annuity payment: the loan is simply paid off early, and there are no
 * further payments to post.
 */
export function amortizationSchedule(
  t: AmortizationTerms,
): AmortizationPeriod[] {
  assertTerms(t);
  const i = periodicRate(t);
  const payment = resolvePayment(t);
  const out: AmortizationPeriod[] = [];

  let balance = t.originalPrincipalCents;
  for (let k = 1; k <= t.termPeriods; k += 1) {
    const row = stepPeriod(k, balance, i, payment, t.termPeriods);
    out.push(row);
    balance = row.closingBalanceCents;
    if (row.isFinal) break;
  }
  return out;
}

/**
 * One period's split, without materialising the whole schedule.
 *
 * The recurrence is inherently sequential (each period's interest depends on
 * the prior balance), so this walks forward internally — but it is a pure
 * function of (terms, index), which is what makes a catch-up backfill of twelve
 * past periods produce byte-identical numbers to what the nightly cron did.
 */
export function amortizationAt(
  t: AmortizationTerms,
  index: number,
): AmortizationPeriod {
  assertTerms(t);
  if (!Number.isInteger(index) || index < 1) {
    throw new AmortizationError(
      'INDEX_BEFORE_ORIGINATION',
      `Payment number ${index} is before the loan started.`,
    );
  }
  if (index > t.termPeriods) {
    // Don't quietly post a phantom payment on a loan that has finished.
    throw new AmortizationError(
      'PAST_TERM',
      `Payment number ${index} is past the end of the ${t.termPeriods}-payment term.`,
    );
  }

  const i = periodicRate(t);
  const payment = resolvePayment(t);
  let balance = t.originalPrincipalCents;

  for (let k = 1; k <= index; k += 1) {
    const row = stepPeriod(k, balance, i, payment, t.termPeriods);
    if (k === index) return row;
    if (row.isFinal) {
      // The loan cleared early — there is no payment number `index`.
      throw new AmortizationError(
        'PAST_TERM',
        `The loan is fully repaid at payment ${k}; payment number ${index} does not exist.`,
      );
    }
    balance = row.closingBalanceCents;
  }
  /* istanbul ignore next — the loop always returns at k === index. */
  throw new AmortizationError('INVALID_TERMS', 'Unreachable.');
}

/**
 * Calendar months between two dates, IGNORING the day of month.
 *
 * Deliberate: `addMonthsClamped` in the recurring poster is documented as
 * drifting — a Jan-31 rule walks 31 → Feb 28 → Mar 28 → Apr 28 and never
 * returns to month-end. A day-sensitive index would drift with it and start
 * repeating or skipping payment numbers. Month arithmetic is drift-proof.
 */
export function calendarMonthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  );
}

/**
 * Which payment number falls on `periodDate`.
 *
 * Derived from the DATE versus the origination anchor — never from a position
 * in a run. That is what keeps the nightly cron (which walks its own cursor)
 * and `planRecurringCatchUp` (which enumerates periods) in agreement: both
 * already produce the same dates, and both feed those dates through this.
 */
export function paymentIndexFor(input: {
  originationDate: Date;
  periodDate: Date;
  frequency: RecurringFrequency;
  /**
   * Offset for a loan that began before it was entered here, when the true
   * origination date isn't available. Prefer setting the real origination date
   * and leaving this at 0.
   */
  paymentsAlreadyMade?: number;
}): number {
  const months = calendarMonthsBetween(
    input.originationDate,
    input.periodDate,
  );
  const offset = input.paymentsAlreadyMade ?? 0;
  let stepsElapsed: number;
  switch (input.frequency) {
    case 'Monthly':
      stepsElapsed = months;
      break;
    case 'Quarterly':
      stepsElapsed = Math.floor(months / 3);
      break;
    case 'Yearly':
      stepsElapsed = Math.floor(months / 12);
      break;
    default:
      throw new AmortizationError(
        'INVALID_TERMS',
        `${input.frequency} payments are not supported for a mortgage split.`,
      );
  }
  const index = stepsElapsed + 1 + offset;
  if (index < 1) {
    throw new AmortizationError(
      'INDEX_BEFORE_ORIGINATION',
      `Period ${input.periodDate.toISOString().slice(0, 10)} is before the loan's origination date.`,
    );
  }
  return index;
}
