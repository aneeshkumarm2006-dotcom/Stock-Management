// Zod validators for CreditCard. DECISIONS.md [G-S-29].
import { z } from 'zod';
import { MASKED_ACCOUNT_REGEX } from '@/lib/db/models/pm/BankAccount';

const maskedCard = z
  .string()
  .min(2)
  .max(20)
  .regex(MASKED_ACCOUNT_REGEX, 'Mask all but last 2–4 digits, e.g. ****1234');

export const creditCardCreateSchema = z.object({
  name: z.string().min(1).max(120),
  cardNumberMasked: maskedCard,
  issuer: z.string().max(40).optional(),
  expirationDate: z.string().datetime().nullable().optional(),
});

export const creditCardUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    cardNumberMasked: maskedCard.optional(),
    issuer: z.string().max(40).optional(),
    expirationDate: z.string().datetime().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type CreditCardCreate = z.infer<typeof creditCardCreateSchema>;
export type CreditCardUpdate = z.infer<typeof creditCardUpdateSchema>;
