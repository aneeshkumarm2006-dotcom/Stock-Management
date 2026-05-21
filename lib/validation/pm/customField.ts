import { z } from 'zod';

const fieldTypeSchema = z.enum([
  'text',
  'number',
  'date',
  'boolean',
  'enum',
]);

const baseShape = {
  entityType: z.string().min(1).max(64),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be lower_snake_case'),
  label: z.string().min(1).max(120),
  fieldType: fieldTypeSchema,
  enumOptions: z.array(z.string().min(1)).optional(),
  required: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
};

export const customFieldCreateSchema = z
  .object(baseShape)
  .refine(
    (d) =>
      d.fieldType !== 'enum' ||
      (d.enumOptions != null && d.enumOptions.length > 0),
    {
      message: 'enumOptions required when fieldType is "enum"',
      path: ['enumOptions'],
    },
  );

export const customFieldUpdateSchema = z
  .object({
    label: baseShape.label.optional(),
    fieldType: fieldTypeSchema.optional(),
    enumOptions: baseShape.enumOptions,
    required: baseShape.required,
    order: baseShape.order,
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });
