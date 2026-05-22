// Zod validators for BillPayment (PDR §3.22). Conditional checkNumber on
// paymentMethod=Check ([G-S-16]).
import { z } from 'zod';
import { BILL_PAYMENT_METHODS } from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const billPaymentCreateSchema = z
  .object({
    billId: objectIdSchema,
    bankAccountId: objectIdSchema.nullable().optional(),
    paymentMethod: z.enum(
      BILL_PAYMENT_METHODS as readonly [string, ...string[]],
    ),
    checkNumber: z.string().max(30).optional(),
    /** Dollars at the API boundary; the route converts to cents. */
    amount: z.number().positive(),
    paidDate: z.string().datetime().or(z.string().date()),
  })
  .refine(
    (d) =>
      d.paymentMethod !== 'Check' ||
      (d.checkNumber && d.checkNumber.trim().length > 0),
    {
      message: 'checkNumber is required when paymentMethod=Check',
      path: ['checkNumber'],
    },
  );

export type BillPaymentCreate = z.infer<typeof billPaymentCreateSchema>;
