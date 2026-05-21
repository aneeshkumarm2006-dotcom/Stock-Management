// Zod validators for Appliance (PDR §3.30).
import { z } from 'zod';
import { objectIdString } from './parentRef';

export const applianceCreateSchema = z.object({
  unitId: objectIdString,
  name: z.string().min(1).max(120),
  installedDate: z.string().datetime().nullable().optional(),
});

export const applianceUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    installedDate: z.string().datetime().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type ApplianceCreate = z.infer<typeof applianceCreateSchema>;
export type ApplianceUpdate = z.infer<typeof applianceUpdateSchema>;
