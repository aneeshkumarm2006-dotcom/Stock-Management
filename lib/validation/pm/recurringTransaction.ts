// Zod validators for RecurringTransaction (PDR §3.23).
// Edits are non-retroactive (BR-AC-8) — `lastPostedDate` and `postedCount`
// are derived and cannot be patched.
import { z } from 'zod';
import {
  RECURRING_DURATIONS,
  RECURRING_FREQUENCIES,
  RECURRING_TRANSACTION_TYPES,
} from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Split a company-scoped amount across that company's properties. */
const allocationSchema = z.object({
  mode: z.enum(['None', 'CompanyProperties']).default('None'),
  basis: z.enum(['Equal', 'Manual']).default('Equal'),
  weights: z
    .array(
      z.object({
        propertyId: objectIdSchema,
        weight: z.number().min(0),
      }),
    )
    // Generous but finite: an org with 200 buildings under one company is
    // already past the point where a manual weight table is the right tool.
    .max(200)
    .optional(),
});

const amountLineSchema = z.object({
  scopeType: z.enum(['Property', 'Company']).default('Company'),
  scopeId: objectIdSchema.nullable().optional(),
  unitId: objectIdSchema.nullable().optional(),
  accountId: objectIdSchema.optional(),
  description: z.string().max(500).optional(),
  refNo: z.string().max(60).optional(),
  /** Dollars at the API boundary; route converts to cents. */
  amount: z.number().optional(),
  // Zod strips unknown keys, so this MUST be declared or both the create and
  // update routes would silently drop the allocation the user just configured.
  allocation: allocationSchema.nullable().optional(),
  /** Same trap: omit this and a configured mortgage silently reverts to
   *  booking the whole payment as expense on the next save. */
  splitAsMortgage: z.boolean().optional(),
});

/**
 * Loan terms. Amounts arrive in dollars, like every other money field here.
 *
 * `SemiAnnual` is the default because Canadian mortgages compound
 * semi-annually by law; it is worth ~$1,300 over a $1M 25-year term, so it is
 * stored explicitly rather than assumed.
 */
const mortgageSchema = z.object({
  originationDate: z.string().datetime().or(z.string().date()),
  /** Dollars at the API boundary; route converts to cents. */
  originalPrincipal: z.number().positive(),
  annualRatePct: z.number().min(0).max(100),
  // 1200 monthly payments is 100 years — a generous ceiling that still rejects
  // a fat-fingered term.
  termPeriods: z.number().int().min(1).max(1200),
  compounding: z.enum(['SemiAnnual', 'PeriodMatched']).default('SemiAnnual'),
  paymentsAlreadyMade: z.number().int().min(0).max(1200).default(0),
  principalAccountId: objectIdSchema,
  interestAccountId: objectIdSchema,
  statementBalance: z.number().min(0).nullable().optional(),
  statementDate: z
    .string()
    .datetime()
    .or(z.string().date())
    .nullable()
    .optional(),
});

// payee no longer required at the schema level — RECURRING_MISSING_PAYEE
// warning fires when payee.id is blank for non-Journal recurrences.
const payeeSchema = z.object({
  type: z.enum(['Vendor', 'RentalOwner']).optional(),
  id: objectIdSchema.optional(),
});

const baseFields = {
  type: z.enum(RECURRING_TRANSACTION_TYPES as readonly [string, ...string[]]).optional(),
  payee: payeeSchema.nullable().optional(),
  bankAccountId: objectIdSchema.nullable().optional(),
  memo: z.string().max(256).optional(),
  frequency: z.enum(RECURRING_FREQUENCIES as readonly [string, ...string[]]).optional(),
  nextDate: z.string().datetime().or(z.string().date()).optional(),
  postNDaysInAdvance: z.number().int().min(0).max(60).default(5),
  duration: z
    .enum(RECURRING_DURATIONS as readonly [string, ...string[]])
    .default('Until cancelled'),
  occurrenceCount: z.number().int().positive().nullable().optional(),
  amounts: z.array(amountLineSchema).optional(),
  mortgage: mortgageSchema.nullable().optional(),
  queueForPrinting: z.boolean().optional(),
  active: z.boolean().optional(),
};

/**
 * Cross-field rules that only make sense once the whole rule is in view.
 *
 * Both are hard errors rather than warnings because either one produces a
 * posting nobody can reconcile:
 *  - a split line with no terms has nothing to split by;
 *  - allocation + split would need the PRINCIPAL SERIES allocated, not the
 *    payment, or "Σ principal === original principal" stops holding. That is a
 *    separate feature, not a combination to allow by accident.
 */
function refineMortgage<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (d: {
        amounts?: Array<{ splitAsMortgage?: boolean }>;
        mortgage?: unknown;
      }) => !(d.amounts ?? []).some((a) => a.splitAsMortgage) || !!d.mortgage,
      {
        message:
          'A line marked as a mortgage payment needs the loan terms (origination date, original principal, rate and term).',
        path: ['mortgage'],
      },
    )
    .refine(
      (d: {
        amounts?: Array<{
          splitAsMortgage?: boolean;
          allocation?: { mode?: string } | null;
        }>;
      }) =>
        !(d.amounts ?? []).some(
          (a) =>
            a.splitAsMortgage &&
            a.allocation &&
            a.allocation.mode === 'CompanyProperties',
        ),
      {
        message:
          'A mortgage payment cannot also be split across company properties. Allocate the loan to one scope, or record a separate mortgage per property.',
        path: ['amounts'],
      },
    )
    .refine(
      (d: {
        amounts?: Array<{ splitAsMortgage?: boolean }>;
      }) => (d.amounts ?? []).filter((a) => a.splitAsMortgage).length <= 1,
      {
        message:
          'Only one line per rule can be the mortgage payment. Use a separate rule for a second loan.',
        path: ['amounts'],
      },
    );
}

// All three blocking refines (payee for non-Journal, occurrenceCount for
// "End after N", and at-least-one-amounts-line) moved to computeWarnings.
export const recurringTransactionCreateSchema = refineMortgage(
  z.object(baseFields),
);

export const recurringTransactionUpdateSchema = z
  .object({
    payee: baseFields.payee,
    bankAccountId: baseFields.bankAccountId,
    memo: baseFields.memo,
    frequency: baseFields.frequency,
    nextDate: baseFields.nextDate,
    postNDaysInAdvance: baseFields.postNDaysInAdvance.optional(),
    duration: baseFields.duration.optional(),
    occurrenceCount: baseFields.occurrenceCount,
    amounts: baseFields.amounts,
    mortgage: baseFields.mortgage,
    queueForPrinting: baseFields.queueForPrinting,
    active: baseFields.active,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export const recurringTransactionUpdateSchemaChecked = refineMortgage(
  recurringTransactionUpdateSchema,
);

export type RecurringTransactionCreate = z.infer<
  typeof recurringTransactionCreateSchema
>;
export type RecurringTransactionUpdate = z.infer<
  typeof recurringTransactionUpdateSchema
>;
