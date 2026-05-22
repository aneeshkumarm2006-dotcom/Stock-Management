// Zod validators for Task (PDR §3.13 skeleton). Full Task UI ships in
// Phase 5; Phase 4 needs CRUD only so WorkOrder can create + select a parent.
import { z } from 'zod';
import { TASK_STATUSES, TASK_TYPES, WORK_PRIORITIES } from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const baseFields = {
  title: z.string().min(1).max(200),
  taskType: z.enum(TASK_TYPES as readonly [string, ...string[]]).optional(),
  status: z.enum(TASK_STATUSES as readonly [string, ...string[]]).optional(),
  priority: z
    .enum(WORK_PRIORITIES as readonly [string, ...string[]])
    .optional(),
  dueDate: z.string().datetime().nullable().optional(),
  categoryId: objectIdSchema.nullable().optional(),
  propertyId: objectIdSchema.nullable().optional(),
  unitId: objectIdSchema.nullable().optional(),
  vendors: z.array(objectIdSchema).optional(),
  assignees: z.array(objectIdSchema).optional(),
  collaborators: z.array(objectIdSchema).optional(),
  sourceTenantId: objectIdSchema.nullable().optional(),
  sourceOwnerId: objectIdSchema.nullable().optional(),
  sourceContactId: objectIdSchema.nullable().optional(),
  description: z.string().max(4000).optional(),
  /** Phase 5 [G-B-31] — M:N to Project. Optional on both create + update. */
  projectIds: z.array(objectIdSchema).optional(),
};

export const taskCreateSchema = z.object(baseFields);

export const taskUpdateSchema = z
  .object({
    title: baseFields.title.optional(),
    taskType: baseFields.taskType,
    status: baseFields.status,
    priority: baseFields.priority,
    dueDate: baseFields.dueDate,
    categoryId: baseFields.categoryId,
    propertyId: baseFields.propertyId,
    unitId: baseFields.unitId,
    vendors: baseFields.vendors,
    assignees: baseFields.assignees,
    collaborators: baseFields.collaborators,
    sourceTenantId: baseFields.sourceTenantId,
    sourceOwnerId: baseFields.sourceOwnerId,
    sourceContactId: baseFields.sourceContactId,
    description: baseFields.description,
    projectIds: baseFields.projectIds,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
