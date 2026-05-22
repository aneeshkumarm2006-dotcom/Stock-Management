// Zod validators for Bill (PDR §3.21).
import { z } from 'zod';
import { BILL_STATUSES } from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const billLineSchema = z.object({
  accountId: objectIdSchema,
  description: z.string().max(500).optional(),
  /** Dollars at the API boundary; the route converts to cents. */
  amount: z.number(),
});

const billScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Property'), id: objectIdSchema }),
  z.object({ type: z.literal('Company'), id: objectIdSchema.nullable() }),
]);

const baseFields = {
  vendorId: objectIdSchema.nullable().optional(),
  dueDate: z.string().datetime().or(z.string().date()),
  status: z.enum(BILL_STATUSES as readonly [string, ...string[]]).optional(),
  memo: z.string().max(2000).optional(),
  refNo: z.string().max(60).optional(),
  scope: billScopeSchema.optional(),
  unitId: objectIdSchema.nullable().optional(),
  lines: z.array(billLineSchema).min(1),
  approverUserIds: z.array(objectIdSchema).optional(),
  attachmentFileId: objectIdSchema.nullable().optional(),
  workOrderId: objectIdSchema.nullable().optional(),
};

export const billCreateSchema = z.object(baseFields);

export const billUpdateSchema = z
  .object({
    vendorId: baseFields.vendorId,
    dueDate: baseFields.dueDate.optional(),
    status: baseFields.status,
    memo: baseFields.memo,
    refNo: baseFields.refNo,
    scope: baseFields.scope,
    unitId: baseFields.unitId,
    lines: baseFields.lines.optional(),
    approverUserIds: baseFields.approverUserIds,
    attachmentFileId: baseFields.attachmentFileId,
    workOrderId: baseFields.workOrderId,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type BillCreate = z.infer<typeof billCreateSchema>;
export type BillUpdate = z.infer<typeof billUpdateSchema>;
export type BillLineInput = z.infer<typeof billLineSchema>;
