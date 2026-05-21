import { z } from 'zod';

export const projectTypeCreateSchema = z.object({
  name: z.string().min(1).max(80),
  color: z
    .string()
    .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Expected hex color')
    .optional(),
});

export const projectTypeUpdateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    color: projectTypeCreateSchema.shape.color,
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });
