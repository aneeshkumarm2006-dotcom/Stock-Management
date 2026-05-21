import { z } from 'zod';

export const vendorCategoryCreateSchema = z.object({
  class: z.string().min(1).max(80),
  subCategory: z.string().max(80).optional(),
});

export const vendorCategoryUpdateSchema = z
  .object({
    class: z.string().min(1).max(80).optional(),
    subCategory: z.string().max(80).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });
