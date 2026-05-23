// Zod validators for Budget (PDR §3.26 + §3.26a, BR-AC-11).
// Monthly amounts ride the wire as dollars and get converted to cents in the
// route handler — same convention as JournalEntry / Bill / EftRequest.
import { z } from 'zod';
import {
  BUDGET_DEFAULT_AMOUNTS,
  BUDGET_LINE_CATEGORIES,
  BUDGET_SCOPE_TYPES,
  FISCAL_MONTHS,
} from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const monthlyDollarsSchema = z
  .array(z.number())
  .length(12, 'monthlyAmounts must be exactly 12 values (one per fiscal month).');

const budgetLineSchema = z.object({
  accountId: objectIdSchema,
  category: z.enum(BUDGET_LINE_CATEGORIES as readonly [string, ...string[]]),
  monthlyAmounts: monthlyDollarsSchema,
});

export const budgetCreateSchema = z
  .object({
    scopeType: z.enum(BUDGET_SCOPE_TYPES as readonly [string, ...string[]]),
    scopeId: objectIdSchema,
    name: z.string().trim().min(1).max(200),
    fiscalYear: z.number().int().min(1900).max(2999),
    fiscalYearStart: z
      .enum(FISCAL_MONTHS as readonly [string, ...string[]])
      .default('January'),
    defaultAmounts: z
      .enum(BUDGET_DEFAULT_AMOUNTS as readonly [string, ...string[]])
      .default('Zero'),
    copySourceBudgetId: objectIdSchema.nullable().optional(),
    lines: z.array(budgetLineSchema).default([]),
  })
  .refine(
    (d) =>
      d.defaultAmounts !== 'Copy existing budget' || !!d.copySourceBudgetId,
    {
      message:
        'copySourceBudgetId is required when defaultAmounts="Copy existing budget"',
      path: ['copySourceBudgetId'],
    },
  );

export const budgetUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    lines: z.array(budgetLineSchema).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type BudgetCreate = z.infer<typeof budgetCreateSchema>;
export type BudgetUpdate = z.infer<typeof budgetUpdateSchema>;
