// Zod validators for CompanyAccount routes (PDR §3.28).
//
// An org is seeded with one CompanyAccount named after the organization, but
// an org may own several legal entities (e.g. "Ramco Development Inc." and
// "Immeubles Greene Inc."), each signing its own mortgages and insurance. Those
// extra rows are created through POST, so a create schema is no longer optional.
import { z } from 'zod';
import { objectIdString } from './parentRef';
import { PM_CURRENCIES } from '@/types/pm';

const currencySchema = z.enum(
  PM_CURRENCIES as unknown as [string, ...string[]],
);

export const companyAccountCreateSchema = z.object({
  name: z.string().min(1).max(200),
  defaultCashAccountId: objectIdString.nullable().optional(),
  /** Omit to inherit `Organization.defaultCurrency` — see resolveCompanyCurrency. */
  currency: currencySchema.nullable().optional(),
});

export const companyAccountUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    defaultCashAccountId: objectIdString.nullable().optional(),
    currency: currencySchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type CompanyAccountCreate = z.infer<typeof companyAccountCreateSchema>;
export type CompanyAccountUpdate = z.infer<typeof companyAccountUpdateSchema>;
