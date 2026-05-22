// Zod validators for EftRequest (PDR §3.24).
// Approved EFTs are immutable — patch payload only accepts a small set of
// fields and the route layer enforces the "void first" rule.
import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const payeeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Vendor'), id: objectIdSchema }),
  z.object({ type: z.literal('RentalOwner'), id: objectIdSchema }),
  z.object({ type: z.literal('Tenant'), id: objectIdSchema }),
]);

export const eftRequestCreateSchema = z.object({
  date: z.string().datetime().or(z.string().date()),
  bankAccountId: objectIdSchema,
  paidToName: z.string().min(1).max(200),
  payee: payeeSchema,
  propertiesScope: z.string().max(500).optional(),
  /** Dollars at the API boundary. */
  amount: z.number().positive(),
  billId: objectIdSchema.nullable().optional(),
});

export const eftRequestUpdateSchema = z
  .object({
    date: z.string().datetime().or(z.string().date()).optional(),
    bankAccountId: objectIdSchema.optional(),
    paidToName: z.string().min(1).max(200).optional(),
    payee: payeeSchema.optional(),
    propertiesScope: z.string().max(500).optional(),
    amount: z.number().positive().optional(),
    billId: objectIdSchema.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export const eftRequestRejectSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export type EftRequestCreate = z.infer<typeof eftRequestCreateSchema>;
export type EftRequestUpdate = z.infer<typeof eftRequestUpdateSchema>;
