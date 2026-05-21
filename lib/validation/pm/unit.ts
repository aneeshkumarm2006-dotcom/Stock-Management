// Zod validators for Unit (PDR §3.2).
import { z } from 'zod';
import { objectIdString } from './parentRef';

export const unitCreateSchema = z.object({
  propertyId: objectIdString,
  unitId: z.string().min(1).max(40),
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.string().max(8).optional(),
  sizeSqft: z.number().int().min(0).optional(),
  description: z.string().max(4000).optional(),
  amenities: z.array(z.string().max(80)).optional(),
});

export const unitUpdateSchema = z
  .object({
    unitId: z.string().min(1).max(40).optional(),
    bedrooms: z.number().int().min(0).max(20).optional(),
    bathrooms: z.string().max(8).optional(),
    sizeSqft: z.number().int().min(0).optional(),
    description: z.string().max(4000).optional(),
    amenities: z.array(z.string().max(80)).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type UnitCreate = z.infer<typeof unitCreateSchema>;
export type UnitUpdate = z.infer<typeof unitUpdateSchema>;
