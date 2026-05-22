// Zod validators for Prospect (PDR §3.9).
import { z } from 'zod';
import { Types } from 'mongoose';
import { PROSPECT_STATUSES } from '@/types/pm';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const base = {
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  status: z.enum(PROSPECT_STATUSES as unknown as [string, ...string[]]).optional(),
  propertyId: objectIdString.nullable().optional(),
  movingDate: z.string().min(8).nullable().optional(),
  beds: z.number().int().min(0).max(10).nullable().optional(),
  notes: z.string().max(4000).optional(),
  customFields: z.record(z.unknown()).optional(),
};

export const prospectCreateSchema = z.object(base);

export const prospectUpdateSchema = z
  .object({
    ...base,
    firstName: base.firstName.optional(),
    lastName: base.lastName.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type ProspectCreate = z.infer<typeof prospectCreateSchema>;
export type ProspectUpdate = z.infer<typeof prospectUpdateSchema>;
