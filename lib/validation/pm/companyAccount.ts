// Zod validators for CompanyAccount routes (PDR §3.28). One-per-org;
// `seedCompanyAccount` auto-creates the row, so create is rarely used —
// PATCH is the common write path (renaming, setting defaultCashAccountId).
import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

export const companyAccountUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    defaultCashAccountId: objectIdString.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type CompanyAccountUpdate = z.infer<typeof companyAccountUpdateSchema>;
