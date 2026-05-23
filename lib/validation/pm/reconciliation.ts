// Zod validators for Reconciliation (PDR §3.16, BR-AC-17).
import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const reconciliationCreateSchema = z.object({
  bankAccountId: objectIdSchema,
  startDate: z.string().datetime().or(z.string().date()),
  endDate: z.string().datetime().or(z.string().date()),
  /** Dollars at the API boundary; converted to cents by the route. */
  statementEndingBalance: z.number(),
  notes: z.string().max(2000).optional(),
});

export const reconciliationUpdateSchema = z
  .object({
    statementEndingBalance: z.number().optional(),
    clearedLines: z
      .array(
        z.object({
          journalEntryId: objectIdSchema,
          lineId: objectIdSchema,
        }),
      )
      .optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type ReconciliationCreate = z.infer<typeof reconciliationCreateSchema>;
export type ReconciliationUpdate = z.infer<typeof reconciliationUpdateSchema>;
