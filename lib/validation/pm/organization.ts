import { z } from 'zod';

export const organizationUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    timezone: z.string().min(1).optional(),
    fiscalYearStart: z
      .string()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Expected MM-DD')
      .optional(),
    accountingMode: z.enum(['cash', 'accrual']).optional(),
    // Change §0A — org-level reporting currency.
    defaultCurrency: z.enum(['USD', 'CAD']).optional(),
    // Change §0C — estimated income-tax rate (percent, 0–100).
    estimatedIncomeTaxRatePct: z.number().min(0).max(100).optional(),
    senderMailbox: z
      .object({
        defaultFrom: z.string().email().optional(),
        perPropertyOverrides: z.record(z.string().email()).optional(),
      })
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });
