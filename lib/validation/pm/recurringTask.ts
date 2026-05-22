// Zod validators for RecurringTask (PDR §3.14, Phase 5).
// BR-TP-5 — `Contact request` is excluded from the accepted taskType set.
import { z } from 'zod';
import {
  RECURRING_DURATIONS,
  RECURRING_FREQUENCIES,
  WORK_PRIORITIES,
} from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** BR-TP-5 — Contact request omitted. */
export const RECURRING_TASK_TYPES = [
  'To do',
  'Resident request',
  'Rental owner request',
] as const;

const baseFields = {
  title: z.string().min(1).max(200),
  taskType: z.enum(RECURRING_TASK_TYPES).default('To do'),
  cadence: z.enum(RECURRING_FREQUENCIES as readonly [string, ...string[]]),
  nextDate: z.string().datetime().or(z.string().date()),
  priority: z
    .enum(WORK_PRIORITIES as readonly [string, ...string[]])
    .default('Normal'),
  categoryId: objectIdSchema.nullable().optional(),
  propertyId: objectIdSchema.nullable().optional(),
  unitId: objectIdSchema.nullable().optional(),
  assignees: z.array(objectIdSchema).optional(),
  description: z.string().max(4000).optional(),
  duration: z
    .enum(RECURRING_DURATIONS as readonly [string, ...string[]])
    .default('Until cancelled'),
  occurrenceCount: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
};

export const recurringTaskCreateSchema = z
  .object(baseFields)
  .refine(
    (d) =>
      d.duration !== 'End after N' ||
      (typeof d.occurrenceCount === 'number' && d.occurrenceCount > 0),
    {
      message: 'occurrenceCount required when duration is "End after N"',
      path: ['occurrenceCount'],
    },
  );

export const recurringTaskUpdateSchema = z
  .object({
    title: baseFields.title.optional(),
    taskType: baseFields.taskType.optional(),
    cadence: baseFields.cadence.optional(),
    nextDate: baseFields.nextDate.optional(),
    priority: baseFields.priority.optional(),
    categoryId: baseFields.categoryId,
    propertyId: baseFields.propertyId,
    unitId: baseFields.unitId,
    assignees: baseFields.assignees,
    description: baseFields.description,
    duration: baseFields.duration.optional(),
    occurrenceCount: baseFields.occurrenceCount,
    active: baseFields.active,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type RecurringTaskCreate = z.infer<typeof recurringTaskCreateSchema>;
export type RecurringTaskUpdate = z.infer<typeof recurringTaskUpdateSchema>;
