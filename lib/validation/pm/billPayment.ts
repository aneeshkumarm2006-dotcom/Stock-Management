// Zod validators for BillPayment (PDR §3.22). Conditional checkNumber on
// paymentMethod=Check ([G-S-16]).
import { z } from 'zod';
import { BILL_PAYMENT_METHODS } from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// Presence requirements (bankAccountId, paidDate) and the
// "checkNumber required when method=Check" refine moved to computeWarnings
// (MISSING_BANK_ACCOUNT, MISSING_CHECK_NUMBER). The schema keeps type
// constraints only. NOTE: billId stays required — there's no payment
// without a bill (true FK integrity).
export const billPaymentCreateSchema = z.object({
  billId: objectIdSchema,
  bankAccountId: objectIdSchema.nullable().optional(),
  paymentMethod: z
    .enum(BILL_PAYMENT_METHODS as readonly [string, ...string[]])
    .optional(),
  checkNumber: z.string().max(30).optional(),
  /** Dollars at the API boundary; the route converts to cents. */
  amount: z.number().nonnegative().optional(),
  paidDate: z.string().datetime().or(z.string().date()).optional(),
});

export type BillPaymentCreate = z.infer<typeof billPaymentCreateSchema>;
