import { z } from 'zod';

export const fileCategoryCreateSchema = z.object({
  name: z.string().min(1).max(80),
});

export const fileCategoryUpdateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });
