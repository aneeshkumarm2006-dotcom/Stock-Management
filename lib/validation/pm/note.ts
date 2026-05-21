import { z } from 'zod';
import { parentTypeSchema } from '@/lib/pm/parentTypes';
import { objectIdString } from './parentRef';

const NOTE_TYPES = [
  'RENTAL',
  'MAINTENANCE',
  'LEASING',
  'ACCOUNTING',
  'GENERAL',
] as const;

export const noteCreateSchema = z.object({
  parentType: parentTypeSchema,
  parentId: objectIdString,
  body: z.string().min(1).max(8000),
  noteType: z.enum(NOTE_TYPES).optional(),
});

export const noteUpdateSchema = z
  .object({
    body: z.string().min(1).max(8000).optional(),
    noteType: z.enum(NOTE_TYPES).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });
