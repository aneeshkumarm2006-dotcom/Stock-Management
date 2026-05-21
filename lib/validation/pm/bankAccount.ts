// Zod validators for BankAccount. DECISIONS.md [G-S-15], [G-S-34].
import { z } from 'zod';
import { MASKED_ACCOUNT_REGEX } from '@/lib/db/models/pm/BankAccount';

const TYPES = ['Checking', 'Savings', 'Cash'] as const;

const maskedAccountNumber = z
  .string()
  .min(2)
  .max(20)
  .regex(MASKED_ACCOUNT_REGEX, 'Mask all but last 2–4 digits, e.g. ****1234');

export const bankAccountCreateSchema = z.object({
  name: z.string().min(1).max(120),
  purpose: z.string().max(200).optional(),
  accountNumberMasked: maskedAccountNumber,
  type: z.enum(TYPES),
  epayEnabled: z.boolean().optional(),
  retailCashEnabled: z.boolean().optional(),
  isCompanyCash: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const bankAccountUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    purpose: z.string().max(200).optional(),
    accountNumberMasked: maskedAccountNumber.optional(),
    type: z.enum(TYPES).optional(),
    epayEnabled: z.boolean().optional(),
    retailCashEnabled: z.boolean().optional(),
    isCompanyCash: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    active: z.boolean().optional(),
    lastReconciliationDate: z.string().datetime().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type BankAccountCreate = z.infer<typeof bankAccountCreateSchema>;
export type BankAccountUpdate = z.infer<typeof bankAccountUpdateSchema>;
