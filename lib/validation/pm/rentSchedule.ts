// Shared Zod validation for a lease's rent-escalation schedule (the "Lease
// Summary"). Used by both the active-lease and draft-lease validators so the
// create, update, and draft paths agree. Client sends rates as ANNUAL DOLLARS
// per sq ft (e.g. 16.5, 17.875) and dates as ISO strings; the route maps them
// straight onto the model (rates are stored as-is, amounts are derived at post
// time — see lib/pm/rentSchedule.ts).
import { z } from 'zod';
import { Types } from 'mongoose';
import { LEASE_TERM_KINDS, type LeaseTermKind } from '@/types/pm';
import {
  findScheduleErrors,
  displayTermForDate,
  monthlyCentsForRate,
  type SchedulePeriod,
} from '@/lib/pm/rentSchedule';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

export const rentSchedulePeriodSchema = z.object({
  label: z.string().min(1).max(60),
  kind: z.enum(LEASE_TERM_KINDS as unknown as [string, ...string[]]).optional(),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  sizeSqft: z.number().nonnegative().optional(),
  baseRatePerSqft: z.number().nonnegative().optional(),
  baseAccountId: objectIdString.nullable().optional(),
  opexRatePerSqft: z.number().nonnegative().optional(),
  opexAccountId: objectIdString.nullable().optional(),
  taxRatePerSqft: z.number().nonnegative().optional(),
  taxAccountId: objectIdString.nullable().optional(),
});

export const rentScheduleSchema = z.array(rentSchedulePeriodSchema);

export type RentSchedulePeriodInput = z.infer<typeof rentSchedulePeriodSchema>;

/**
 * Cross-period + per-period business rules for a submitted schedule. Reuses
 * `findScheduleErrors` (ordering / overlap / "≥1 Term" / base-rate>0) and adds
 * the posting-readiness rule: a component with a rate > 0 needs an income
 * account so the rent poster can credit it. Push issues onto the Zod ctx so the
 * client gets field-pathed errors.
 */
export function refineRentSchedule(
  periods: RentSchedulePeriodInput[] | undefined,
  ctx: z.RefinementCtx,
  path: (string | number)[] = ['rentSchedule'],
): void {
  if (!periods || periods.length === 0) return;

  // Structural errors (dates, ordering, overlap, ≥1 Term, base rate present).
  const structural = findScheduleErrors(
    periods.map((p) => ({
      label: p.label,
      kind: (p.kind ?? 'Term') as SchedulePeriod['kind'],
      startDate: new Date(p.startDate),
      endDate: new Date(p.endDate),
      sizeSqft: p.sizeSqft ?? 0,
      baseRatePerSqft: p.baseRatePerSqft ?? 0,
      opexRatePerSqft: p.opexRatePerSqft ?? 0,
      taxRatePerSqft: p.taxRatePerSqft ?? 0,
    })),
  );
  for (const message of structural) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  }

  // Posting-readiness: a Term row with a rate > 0 must carry the matching
  // income account (RenewalOption rows are never posted, so accounts optional).
  periods.forEach((p, i) => {
    if ((p.kind ?? 'Term') !== 'Term') return;
    if ((p.baseRatePerSqft ?? 0) > 0 && !p.baseAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, i, 'baseAccountId'],
        message: `Term "${p.label}" needs a base rent income account.`,
      });
    }
    if ((p.opexRatePerSqft ?? 0) > 0 && !p.opexAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, i, 'opexAccountId'],
        message: `Term "${p.label}" needs an OPEX recovery income account.`,
      });
    }
    if ((p.taxRatePerSqft ?? 0) > 0 && !p.taxAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, i, 'taxAccountId'],
        message: `Term "${p.label}" needs a tax recovery income account.`,
      });
    }
  });
}

/** Model-shaped period: ISO/string inputs converted to Date + ObjectId, ready
 *  to assign to a Lease/DraftLease `rentSchedule`. */
export interface RentSchedulePeriodModel {
  label: string;
  kind: LeaseTermKind;
  startDate: Date;
  endDate: Date;
  sizeSqft: number;
  baseRatePerSqft: number;
  baseAccountId: Types.ObjectId | null;
  opexRatePerSqft: number;
  opexAccountId: Types.ObjectId | null;
  taxRatePerSqft: number;
  taxAccountId: Types.ObjectId | null;
}

/** Convert validated period inputs (dollars, ISO dates, id strings) into the
 *  model shape persisted on the lease. */
export function mapRentScheduleToModel(
  periods?: RentSchedulePeriodInput[] | null,
): RentSchedulePeriodModel[] {
  return (periods ?? []).map((p) => ({
    label: p.label,
    kind: (p.kind ?? 'Term') as LeaseTermKind,
    startDate: new Date(p.startDate),
    endDate: new Date(p.endDate),
    sizeSqft: p.sizeSqft ?? 0,
    baseRatePerSqft: p.baseRatePerSqft ?? 0,
    baseAccountId: p.baseAccountId ? new Types.ObjectId(p.baseAccountId) : null,
    opexRatePerSqft: p.opexRatePerSqft ?? 0,
    opexAccountId: p.opexAccountId ? new Types.ObjectId(p.opexAccountId) : null,
    taxRatePerSqft: p.taxRatePerSqft ?? 0,
    taxAccountId: p.taxAccountId ? new Types.ObjectId(p.taxAccountId) : null,
  }));
}

/**
 * Derive the legacy `primaryRent` + `splitRentCharges` snapshot from the
 * schedule's CURRENT period (active at `today`, else the first Term). This keeps
 * the rent roll / financials / tenant card showing the right current rent and
 * gives the poster a correct fallback. Returns null when no Term has a base
 * income account (e.g. an options-only or empty schedule) so the caller leaves
 * the existing primaryRent untouched.
 */
export function deriveCurrentRentFromSchedule(
  modelPeriods: RentSchedulePeriodModel[],
  today: Date,
): {
  amount: number;
  accountId: Types.ObjectId;
  memo: string;
  splitRentCharges: { accountId: Types.ObjectId; amount: number; memo: string }[];
} | null {
  if (!modelPeriods || modelPeriods.length === 0) return null;
  const term = displayTermForDate(modelPeriods as SchedulePeriod[], today);
  if (!term || !term.baseAccountId) return null;

  const baseMonthly = monthlyCentsForRate(term.baseRatePerSqft, term.sizeSqft);
  const opexMonthly = monthlyCentsForRate(term.opexRatePerSqft, term.sizeSqft);
  const taxMonthly = monthlyCentsForRate(term.taxRatePerSqft, term.sizeSqft);

  const splitRentCharges: {
    accountId: Types.ObjectId;
    amount: number;
    memo: string;
  }[] = [];
  if (opexMonthly > 0 && term.opexAccountId) {
    splitRentCharges.push({
      accountId: term.opexAccountId as Types.ObjectId,
      amount: opexMonthly,
      memo: 'OPEX Recovery',
    });
  }
  if (taxMonthly > 0 && term.taxAccountId) {
    splitRentCharges.push({
      accountId: term.taxAccountId as Types.ObjectId,
      amount: taxMonthly,
      memo: 'Tax Recovery',
    });
  }

  return {
    amount: baseMonthly,
    accountId: term.baseAccountId as Types.ObjectId,
    memo: `Base rent — ${term.label}`,
    splitRentCharges,
  };
}
