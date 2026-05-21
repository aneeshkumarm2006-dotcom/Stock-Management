// Zod validators for Deposit routes (BR-AC-6, BR-AC-14, PDR §3.20).
// Client sends `amount` in dollars; route multiplies by 100 → cents.
import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const scopeType = z.enum(['Property', 'Company']);

const depositItemSchema = z
  .object({
    scopeType,
    scopeId: objectIdString.nullable().optional(),
    unitId: objectIdString.nullable().optional(),
    accountId: objectIdString,
    description: z.string().max(500).optional(),
    refNo: z.string().max(60).optional(),
    amount: z.number().positive(),
  })
  .superRefine((item, ctx) => {
    if (item.scopeType === 'Property' && !item.scopeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Property-scoped deposit lines require scopeId',
        path: ['scopeId'],
      });
    }
  });

export const depositCreateSchema = z.object({
  bankAccountId: objectIdString,
  date: z.string().datetime({ offset: true }).or(z.string().min(8)),
  memo: z.string().max(2000).optional(),
  attachmentFileId: objectIdString.nullable().optional(),
  depositItems: z
    .array(depositItemSchema)
    .min(1, 'A deposit requires at least one item'),
});

export const depositUpdateSchema = z
  .object({
    date: z.string().min(8).optional(),
    memo: z.string().max(2000).optional(),
    attachmentFileId: objectIdString.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type DepositCreate = z.infer<typeof depositCreateSchema>;
export type DepositUpdate = z.infer<typeof depositUpdateSchema>;
