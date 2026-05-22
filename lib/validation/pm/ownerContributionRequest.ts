// Zod validators for OwnerContributionRequest (PDR §3.25, Phase 5 skeleton).
// Full editor + multi-step approve flow ships in Phase 9; these schemas
// cover only POST/PATCH for the cross-link with Task.
import { z } from 'zod';
import {
  OWNER_CONTRIBUTION_PRIORITIES_DB,
  OWNER_CONTRIBUTION_STATUSES_DB,
} from '@/lib/db/models/pm/OwnerContributionRequest';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const baseFields = {
  status: z.enum(OWNER_CONTRIBUTION_STATUSES_DB).default('New'),
  dueDate: z.string().datetime().or(z.string().date()),
  propertiesScope: z.string().min(1).max(200),
  taskDescription: z.string().min(1).max(2000),
  requestedFromOwnerId: objectIdSchema,
  priority: z.enum(OWNER_CONTRIBUTION_PRIORITIES_DB).default('Normal'),
  /** Dollars at the API boundary; persisted as cents. */
  requestedAmount: z.number().nonnegative(),
  receivedAmount: z.number().nonnegative().optional(),
  taskId: objectIdSchema.nullable().optional(),
};

export const ownerContributionRequestCreateSchema = z.object(baseFields);

export const ownerContributionRequestUpdateSchema = z
  .object({
    status: baseFields.status.optional(),
    dueDate: baseFields.dueDate.optional(),
    propertiesScope: baseFields.propertiesScope.optional(),
    taskDescription: baseFields.taskDescription.optional(),
    requestedFromOwnerId: baseFields.requestedFromOwnerId.optional(),
    priority: baseFields.priority.optional(),
    requestedAmount: baseFields.requestedAmount.optional(),
    receivedAmount: baseFields.receivedAmount,
    taskId: baseFields.taskId,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type OwnerContributionRequestCreate = z.infer<
  typeof ownerContributionRequestCreateSchema
>;
export type OwnerContributionRequestUpdate = z.infer<
  typeof ownerContributionRequestUpdateSchema
>;
