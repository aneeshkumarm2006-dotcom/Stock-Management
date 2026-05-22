// Zod validators for Project (PDR §3.15, Phase 5).
// BR-TP-8 — Tasks can only be added to a Project after creation; the create
// schema refuses a `tasks[]` field. The post-creation link lives at
// /api/pm/projects/[id]/tasks via projectAddTasksSchema.
//
// `budget` is dollars at the API boundary; the route converts to cents.
import { z } from 'zod';
import { PROJECT_STATUSES_DB } from '@/lib/db/models/pm/Project';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const projectCreateSchema = z
  .object({
    projectTypeId: objectIdSchema,
    propertyId: objectIdSchema,
    projectLeadUserId: objectIdSchema,
    name: z.string().max(200).optional(),
    description: z.string().max(4000).optional(),
    /** Dollars at the API boundary; persisted as cents. */
    budget: z.number().nonnegative().optional(),
    dueDate: z.string().datetime().or(z.string().date()).nullable().optional(),
  })
  .strict();

export const projectUpdateSchema = z
  .object({
    projectTypeId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    projectLeadUserId: objectIdSchema.optional(),
    name: z.string().max(200).optional(),
    description: z.string().max(4000).optional(),
    budget: z.number().nonnegative().optional(),
    dueDate: z.string().datetime().or(z.string().date()).nullable().optional(),
    status: z.enum(PROJECT_STATUSES_DB).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export const projectAddTasksSchema = z.object({
  taskIds: z.array(objectIdSchema).min(1).max(100),
});

export const projectRemoveTasksSchema = projectAddTasksSchema;

export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type ProjectAddTasks = z.infer<typeof projectAddTasksSchema>;
