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
  accountId: objectIdSchema.optional(),
  description: z.string().max(500).optional(),
  refNo: z.string().max(60).optional(),
  /** Dollars at the API boundary; route converts to cents. */
  amount: z.number().optional(),
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
  queueForPrinting: z.boolean().optional(),
  active: z.boolean().optional(),
};

// All three blocking refines (payee for non-Journal, occurrenceCount for
// "End after N", and at-least-one-amounts-line) moved to computeWarnings.
export const recurringTransactionCreateSchema = z.object(baseFields);

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
