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

const amountLineSchema = z.object({
  scopeType: z.enum(['Property', 'Company']).default('Company'),
  scopeId: objectIdSchema.nullable().optional(),
  unitId: objectIdSchema.nullable().optional(),
  accountId: objectIdSchema,
  description: z.string().max(500).optional(),
  refNo: z.string().max(60).optional(),
  /** Dollars at the API boundary; route converts to cents. */
  amount: z.number(),
});

const payeeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Vendor'), id: objectIdSchema }),
  z.object({ type: z.literal('RentalOwner'), id: objectIdSchema }),
]);

const baseFields = {
  type: z.enum(RECURRING_TRANSACTION_TYPES as readonly [string, ...string[]]),
  payee: payeeSchema.nullable().optional(),
  bankAccountId: objectIdSchema.nullable().optional(),
  memo: z.string().max(256).optional(),
  frequency: z.enum(RECURRING_FREQUENCIES as readonly [string, ...string[]]),
  nextDate: z.string().datetime().or(z.string().date()),
  postNDaysInAdvance: z.number().int().min(0).max(60).default(5),
  duration: z
    .enum(RECURRING_DURATIONS as readonly [string, ...string[]])
    .default('Until cancelled'),
  occurrenceCount: z.number().int().positive().nullable().optional(),
  amounts: z.array(amountLineSchema).min(1),
  queueForPrinting: z.boolean().optional(),
  active: z.boolean().optional(),
};

export const recurringTransactionCreateSchema = z
  .object(baseFields)
  .refine(
    (d) => d.type === 'Journal entry' || (d.payee && d.payee.id),
    {
      message: 'payee is required when type is Check or Bill',
      path: ['payee'],
    },
  )
  .refine(
    (d) =>
      d.duration !== 'End after N' ||
      (typeof d.occurrenceCount === 'number' && d.occurrenceCount > 0),
    {
      message: 'occurrenceCount required when duration is "End after N"',
      path: ['occurrenceCount'],
    },
  );

export const recurringTransactionUpdateSchema = z
  .object({
    payee: baseFields.payee,
    bankAccountId: baseFields.bankAccountId,
    memo: baseFields.memo,
    frequency: baseFields.frequency.optional(),
    nextDate: baseFields.nextDate.optional(),
    postNDaysInAdvance: baseFields.postNDaysInAdvance.optional(),
    duration: baseFields.duration.optional(),
    occurrenceCount: baseFields.occurrenceCount,
    amounts: baseFields.amounts.optional(),
    queueForPrinting: baseFields.queueForPrinting,
    active: baseFields.active,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type RecurringTransactionCreate = z.infer<
  typeof recurringTransactionCreateSchema
>;
export type RecurringTransactionUpdate = z.infer<
  typeof recurringTransactionUpdateSchema
>;
