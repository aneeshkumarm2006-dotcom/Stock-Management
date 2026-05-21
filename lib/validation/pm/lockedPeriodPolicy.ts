// Zod validators for LockedPeriodPolicy admin routes (PDR §3.27, BR-AC-3).
import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const scope = z.enum(['Global', 'Per-property']);

export const lockedPeriodCreateSchema = z
  .object({
    scope,
    propertyId: objectIdString.nullable().optional(),
    fromDate: z.string().min(8).nullable().optional(),
    toDate: z.string().min(8).nullable().optional(),
    message: z.string().max(500).optional(),
    active: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scope === 'Per-property' && !data.propertyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Per-property locks require a propertyId',
        path: ['propertyId'],
      });
    }
    if (data.scope === 'Global' && data.propertyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Global locks must not carry a propertyId',
        path: ['propertyId'],
      });
    }
  });

export const lockedPeriodUpdateSchema = z
  .object({
    scope: scope.optional(),
    propertyId: objectIdString.nullable().optional(),
    fromDate: z.string().min(8).nullable().optional(),
    toDate: z.string().min(8).nullable().optional(),
    message: z.string().max(500).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type LockedPeriodCreate = z.infer<typeof lockedPeriodCreateSchema>;
export type LockedPeriodUpdate = z.infer<typeof lockedPeriodUpdateSchema>;
