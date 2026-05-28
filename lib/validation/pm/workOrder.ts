// Zod validators for WorkOrder (PDR §3.10 + §3.10a).
// Polymorphic chargeWorkTo uses z.discriminatedUnion per [G-B-30].
import { z } from 'zod';
import {
  ENTRY_DETAILS,
  WORK_ORDER_STATUSES,
  WORK_PRIORITIES,
} from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const partsAndLaborItemSchema = z.object({
  qty: z.number().min(0).default(1),
  accountId: objectIdSchema,
  description: z.string().max(500).optional(),
  /** Dollars at the API boundary; the route converts to cents. */
  price: z.number().min(0).default(0),
});

const chargeWorkToSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Property'), id: objectIdSchema }),
  z.object({ type: z.literal('Lease'), id: objectIdSchema }),
  z.object({ type: z.literal('RentalOwner'), id: objectIdSchema }),
]);

/** Allow inline-creation of a parent Task at WO-creation time (BR-MV-5).
 *  The route handler creates the Task first when `taskNew` is present and
 *  rejects when neither `taskId` nor `taskNew` is supplied. */
const taskInlineCreateSchema = z.object({
  title: z.string().max(200).optional(),
  taskType: z.string().optional(),
  priority: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  propertyId: objectIdSchema.optional(),
  unitId: objectIdSchema.optional(),
  description: z.string().max(4000).optional(),
});

const baseFields = {
  subject: z.string().max(200).optional(),
  vendorId: objectIdSchema.optional(),
  status: z
    .enum(WORK_ORDER_STATUSES as readonly [string, ...string[]])
    .optional(),
  priority: z
    .enum(WORK_PRIORITIES as readonly [string, ...string[]])
    .optional(),
  dueDate: z.string().datetime().nullable().optional(),
  taskId: objectIdSchema.optional(),
  taskNew: taskInlineCreateSchema.optional(),
  taskType: z.string().max(60).optional(),
  taskCategoryId: objectIdSchema.nullable().optional(),
  assignedToUserId: objectIdSchema.optional(),
  collaborators: z.array(objectIdSchema).optional(),
  workToBePerformed: z.string().max(4000).optional(),
  vendorNotes: z.string().max(4000).optional(),
  entryDetails: z
    .enum(ENTRY_DETAILS as readonly [string, ...string[]])
    .optional(),
  entryContacts: z.array(objectIdSchema).optional(),
  files: z.array(objectIdSchema).optional(),
  invoiceNumber: z.string().max(60).optional(),
  chargeWorkTo: chargeWorkToSchema.nullable().optional(),
  partsAndLabor: z.array(partsAndLaborItemSchema).optional(),
  unitId: objectIdSchema.nullable().optional(),
  propertyId: objectIdSchema.nullable().optional(),
};

// The "every WO needs a parent task" refine was a hard 400. The route now
// creates a default Task when neither taskId nor taskNew is supplied, so the
// row always has a parent — but the absence of an explicit user-picked task
// surfaces as a (future) warning if we choose to add one.
export const workOrderCreateSchema = z.object(baseFields);

export const workOrderUpdateSchema = z
  .object({
    subject: baseFields.subject.optional(),
    vendorId: baseFields.vendorId.optional(),
    status: baseFields.status,
    priority: baseFields.priority,
    dueDate: baseFields.dueDate,
    assignedToUserId: baseFields.assignedToUserId.optional(),
    collaborators: baseFields.collaborators,
    workToBePerformed: baseFields.workToBePerformed,
    vendorNotes: baseFields.vendorNotes,
    entryDetails: baseFields.entryDetails,
    entryContacts: baseFields.entryContacts,
    files: baseFields.files,
    invoiceNumber: baseFields.invoiceNumber,
    chargeWorkTo: baseFields.chargeWorkTo,
    partsAndLabor: baseFields.partsAndLabor,
    unitId: baseFields.unitId,
    propertyId: baseFields.propertyId,
    taskCategoryId: baseFields.taskCategoryId,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type WorkOrderCreate = z.infer<typeof workOrderCreateSchema>;
export type WorkOrderUpdate = z.infer<typeof workOrderUpdateSchema>;
export type PartsAndLaborItem = z.infer<typeof partsAndLaborItemSchema>;
