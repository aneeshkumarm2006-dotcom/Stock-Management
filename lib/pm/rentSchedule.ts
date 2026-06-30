// rentSchedule — the single computation + resolution source for a commercial
// lease's rent-escalation schedule (the client's "Lease Summary": Year 1‑2,
// Year 3‑5, … plus a Renewal Option).
//
// RATE CONVENTION (matches the sheet): every per‑sqft rate is ANNUAL DOLLARS
// per square foot (e.g. 16.5, 17.875). Rates are multipliers, not ledger
// amounts, so a fractional cent like $17.875/sf is fine — only the RESOLVED
// amounts are integer cents:
//   annual cents  = round(rateDollars × sizeSqft × 100)
//   monthly cents = round(annual / 12)
// This is the commercial $/sf/YEAR convention and is INTENTIONALLY independent
// of the legacy `primaryRent.rentMethod='RatePerSqft'`, which treats its rate
// as a MONTHLY cents rate. Keeping them separate means existing leases are
// untouched.
//
// All money is integer cents (the project-wide convention — see currency.ts).
//
// This module has NO runtime dependencies (mongoose types are imported
// type-only and erased at compile), so the pure display helpers are safe to
// import from client components (the schedule editor computes amounts live).
import type { Types } from 'mongoose';
import type { LeaseTermKind } from '@/types/pm';
import type { RentChargeSource } from '@/lib/pm/rentCharge';

/** Minimal rate inputs for the pure display math — structural so the client
 *  editor can call `computePeriodAmounts` without importing the Mongoose model.
 *  Rates are ANNUAL DOLLARS per sq ft. */
export interface PeriodRateInput {
  sizeSqft: number;
  baseRatePerSqft: number;
  opexRatePerSqft: number;
  taxRatePerSqft: number;
}

/** A stored schedule period (mirrors `ILeaseTermPeriod` structurally). */
export interface SchedulePeriod extends PeriodRateInput {
  label: string;
  kind: LeaseTermKind;
  startDate: Date;
  endDate: Date;
  baseAccountId?: Types.ObjectId | null;
  opexAccountId?: Types.ObjectId | null;
  taxAccountId?: Types.ObjectId | null;
}

/** Every computed dollar figure (integer cents) for one period — mirrors the
 *  columns of the client's sheet. */
export interface PeriodAmounts {
  baseAnnual: number;
  baseMonthly: number;
  opexAnnual: number;
  opexMonthly: number;
  taxAnnual: number;
  taxMonthly: number;
  totalBeforeTaxAnnual: number;
  totalBeforeTaxMonthly: number;
  /** totalBeforeTax grossed up by the combined GST/QST rate. */
  totalWithGstMonthly: number;
  totalWithGstAnnual: number;
}

/** Annual rent (cents) from an annual $/sf rate (dollars) × square footage. */
export function annualCentsForRate(
  rateDollarsPerSqft: number,
  sizeSqft: number,
): number {
  return Math.round((rateDollarsPerSqft || 0) * (sizeSqft || 0) * 100);
}

/** Monthly rent (cents) = annual / 12, rounded to whole cents. */
export function monthlyCentsForRate(
  rateDollarsPerSqft: number,
  sizeSqft: number,
): number {
  return Math.round(annualCentsForRate(rateDollarsPerSqft, sizeSqft) / 12);
}

/**
 * Compute every dollar figure for one period from its rates × sizeSqft.
 * Component annuals/monthlies are rounded independently and summed (so the
 * table rows add up to the totals exactly). `salesTaxRatePct` (e.g. 14.975)
 * is applied only to the "Total With GST/QST" lines — a display gross-up, never
 * posted to the ledger.
 */
export function computePeriodAmounts(
  input: PeriodRateInput,
  salesTaxRatePct?: number | null,
): PeriodAmounts {
  const sf = input.sizeSqft || 0;
  const baseAnnual = annualCentsForRate(input.baseRatePerSqft, sf);
  const opexAnnual = annualCentsForRate(input.opexRatePerSqft, sf);
  const taxAnnual = annualCentsForRate(input.taxRatePerSqft, sf);
  const baseMonthly = Math.round(baseAnnual / 12);
  const opexMonthly = Math.round(opexAnnual / 12);
  const taxMonthly = Math.round(taxAnnual / 12);
  const totalBeforeTaxAnnual = baseAnnual + opexAnnual + taxAnnual;
  const totalBeforeTaxMonthly = baseMonthly + opexMonthly + taxMonthly;
  const gross = 1 + (salesTaxRatePct ?? 0) / 100;
  return {
    baseAnnual,
    baseMonthly,
    opexAnnual,
    opexMonthly,
    taxAnnual,
    taxMonthly,
    totalBeforeTaxAnnual,
    totalBeforeTaxMonthly,
    totalWithGstMonthly: Math.round(totalBeforeTaxMonthly * gross),
    totalWithGstAnnual: Math.round(totalBeforeTaxAnnual * gross),
  };
}

/** The Term period (never a RenewalOption) whose [startDate, endDate] window
 *  contains `date`, or null when none applies. Dates are inclusive on both
 *  ends; the period covering the due date wins at a boundary. */
export function activeTermPeriodForDate<T extends SchedulePeriod>(
  periods: readonly T[] | undefined | null,
  date: Date,
): T | null {
  if (!periods || periods.length === 0) return null;
  const t = date.getTime();
  for (const p of periods) {
    if (p.kind !== 'Term') continue;
    const start = p.startDate ? new Date(p.startDate).getTime() : null;
    const end = p.endDate ? new Date(p.endDate).getTime() : null;
    if (start !== null && t < start) continue;
    if (end !== null && t > end) continue;
    return p;
  }
  return null;
}

/** The Term to SHOW as the lease's "current" period (for keeping the legacy
 *  `primaryRent`/`splitRentCharges` in sync as a resolved snapshot): the Term
 *  active at `date`, else the earliest Term by start date (so a wholly-future
 *  lease shows its first period). Null when there are no Term periods. */
export function displayTermForDate<T extends SchedulePeriod>(
  periods: readonly T[] | undefined | null,
  date: Date,
): T | null {
  const active = activeTermPeriodForDate(periods, date);
  if (active) return active;
  const terms = (periods ?? []).filter((p) => p.kind === 'Term');
  if (terms.length === 0) return null;
  return (
    [...terms].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    )[0] ?? null
  );
}

/** Lease shape the resolver needs — kept structural so both poster paths and
 *  the routes can pass a Mongoose doc or a lean object. */
export interface ScheduledLeaseLike {
  rentSchedule?: SchedulePeriod[] | null;
  primaryRent: { amount: number; accountId: Types.ObjectId; memo?: string };
  splitRentCharges: { amount: number; accountId: Types.ObjectId; memo?: string }[];
  propertyId: Types.ObjectId;
  unitId: Types.ObjectId;
}

/**
 * Resolve the `RentChargeSource` to post for a lease on `date`:
 *   - NO schedule           → the legacy `primaryRent` + `splitRentCharges`
 *                             (existing single-rent behavior, unchanged).
 *   - schedule, active Term → base+OPEX+tax built from that Term's rates × sf.
 *   - schedule, no active   → `null` (nothing to post; e.g. a RenewalOption
 *     Term window            window that hasn't been exercised, or a gap).
 *
 * `buildRentChargeLines` consumes the returned source; a `null` means the
 * caller posts nothing and leaves the cursor where it is.
 */
export function resolveScheduledRentForDate(
  lease: ScheduledLeaseLike,
  date: Date,
): RentChargeSource | null {
  const schedule = lease.rentSchedule ?? [];
  if (schedule.length === 0) {
    // Legacy single-rent lease — post exactly as before.
    return {
      primaryRent: lease.primaryRent,
      splitRentCharges: lease.splitRentCharges ?? [],
      propertyId: lease.propertyId,
      unitId: lease.unitId,
    };
  }

  const period = activeTermPeriodForDate(schedule, date);
  if (!period) return null; // schedule present but nothing active to post

  const sf = period.sizeSqft || 0;
  const baseMonthly = monthlyCentsForRate(period.baseRatePerSqft, sf);
  const opexMonthly = monthlyCentsForRate(period.opexRatePerSqft, sf);
  const taxMonthly = monthlyCentsForRate(period.taxRatePerSqft, sf);

  // A Term row without a base income account can't post — treat as nothing.
  if (!period.baseAccountId) return null;

  const splits: RentChargeSource['splitRentCharges'] = [];
  if (opexMonthly > 0 && period.opexAccountId) {
    splits.push({
      accountId: period.opexAccountId,
      amount: opexMonthly,
      memo: `OPEX Recovery — ${period.label}`,
    });
  }
  if (taxMonthly > 0 && period.taxAccountId) {
    splits.push({
      accountId: period.taxAccountId,
      amount: taxMonthly,
      memo: `Tax Recovery — ${period.label}`,
    });
  }

  return {
    primaryRent: {
      amount: baseMonthly,
      accountId: period.baseAccountId,
      memo: `Base rent — ${period.label}`,
    },
    splitRentCharges: splits,
    propertyId: lease.propertyId,
    unitId: lease.unitId,
  };
}

/**
 * Pure cross-period validation shared by the Zod schemas. Returns a list of
 * human-readable problems (empty when the schedule is valid). Overlaps and
 * "no Term period" are hard errors; gaps are NOT flagged here (a lease may
 * legitimately have a vacancy gap) — the editor surfaces gaps as a soft hint.
 */
export function findScheduleErrors(periods: readonly SchedulePeriod[]): string[] {
  const errors: string[] = [];
  if (periods.length === 0) return errors; // empty schedule is allowed
  const terms = periods.filter((p) => p.kind === 'Term');
  if (terms.length === 0) {
    errors.push('A rent schedule must contain at least one Term period.');
  }
  for (const p of periods) {
    const start = p.startDate ? new Date(p.startDate).getTime() : NaN;
    const end = p.endDate ? new Date(p.endDate).getTime() : NaN;
    if (Number.isNaN(start) || Number.isNaN(end)) {
      errors.push(`Period "${p.label || '(unnamed)'}" needs a start and end date.`);
    } else if (end <= start) {
      errors.push(`Period "${p.label || '(unnamed)'}" end date must be after its start date.`);
    }
    if (p.kind === 'Term' && !(p.baseRatePerSqft > 0)) {
      errors.push(`Term period "${p.label || '(unnamed)'}" needs a base rent rate greater than 0.`);
    }
  }
  // Overlap check among Term periods (sorted by start).
  const sortedTerms = [...terms].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );
  for (let i = 1; i < sortedTerms.length; i++) {
    const prev = sortedTerms[i - 1];
    const cur = sortedTerms[i];
    if (!prev || !cur) continue;
    if (new Date(cur.startDate).getTime() <= new Date(prev.endDate).getTime()) {
      errors.push(
        `Term periods "${prev.label || '(unnamed)'}" and "${cur.label || '(unnamed)'}" overlap.`,
      );
    }
  }
  return errors;
}
