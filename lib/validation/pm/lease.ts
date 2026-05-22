// Zod validators for the active Lease entity (PDR §3.3). Mirrors most of the
// DraftLease shape since promotion is a near-straight copy. Client sends
// money in dollars; the route converts to cents.
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  ESIGNATURE_STATUSES,
  LEASE_TYPES,
  LEASE_STATUSES,
  RENT_CYCLES,
} from '@/types/pm';
import { LEASE_INLINE_FILE_CAP } from '@/lib/db/models/pm/DraftLease';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const memo = z.string().max(100);

const tenantRefSchema = z.object({
  tenantId: objectIdString,
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional().or(z.literal('')),
  isCosigner: z.boolean().optional(),
});

const splitRentSchema = z.object({
  accountId: objectIdString,
  amount: z.number().nonnegative(),
  memo: memo.optional(),
});

const primaryRentSchema = z.object({
  amount: z.number().nonnegative(),
  accountId: objectIdString,
  nextDueDate: z.string().min(8).nullable().optional(),
  memo: memo.optional(),
});

const recurringChargeSchema = z.object({
  amount: z.number().nonnegative(),
  accountId: objectIdString,
  frequency: z.enum(RENT_CYCLES as unknown as [string, ...string[]]),
  nextDate: z.string().min(8).nullable().optional(),
  memo: memo.optional(),
  postNDaysInAdvance: z.number().int().min(0).max(30).optional(),
});

const oneTimeChargeSchema = z.object({
  amount: z.number().nonnegative(),
  accountId: objectIdString,
  dueDate: z.string().min(8).nullable().optional(),
  memo: memo.optional(),
});

const lateFeeSchema = z.object({
  enabled: z.boolean().optional(),
  feeAmount: z.number().nonnegative().optional(),
  feePctOfRent: z.number().min(0).max(100).optional(),
  daysAfterDue: z.number().int().min(0).optional(),
  capAmount: z.number().nonnegative().optional(),
});

const esigDocSchema = z.object({
  fileId: objectIdString.nullable().optional(),
  role: z.enum(['Lease', 'Addendum']).optional(),
  label: z.string().min(1).max(200),
  status: z.enum(ESIGNATURE_STATUSES as unknown as [string, ...string[]]).optional(),
});

const base = {
  propertyId: objectIdString,
  unitId: objectIdString,
  rentalOwnerId: objectIdString.nullable().optional(),
  tenants: z.array(tenantRefSchema).min(1),
  cosigners: z.array(tenantRefSchema).optional(),
  leaseType: z.enum(LEASE_TYPES as unknown as [string, ...string[]]),
  startDate: z.string().min(8),
  endDate: z.string().min(8).nullable().optional(),
  rentCycle: z.enum(RENT_CYCLES as unknown as [string, ...string[]]).optional(),
  primaryRent: primaryRentSchema,
  splitRentCharges: z.array(splitRentSchema).optional(),
  securityDepositReceived: z.number().nonnegative().optional(),
  recurringCharges: z.array(recurringChargeSchema).optional(),
  oneTimeCharges: z.array(oneTimeChargeSchema).optional(),
  lateFeePolicy: lateFeeSchema.optional(),
  residentCenterWelcomeEmail: z.boolean().optional(),
  esignatureDocuments: z.array(esigDocSchema).optional(),
  comments: z.string().max(4000).optional(),
  files: z.array(objectIdString).max(LEASE_INLINE_FILE_CAP).optional(),
  customFields: z.record(z.unknown()).optional(),
};

/** BR-LL-1 — Fixed/Fixed w/rollover require endDate; At-will rejects
 *  endDate. Shared between create and update. */
function applyBrLl1(
  data: { leaseType?: string; endDate?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (
    (data.leaseType === 'Fixed' || data.leaseType === 'Fixed w/rollover') &&
    !data.endDate
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'Fixed-term leases require an endDate (BR-LL-1).',
    });
  }
  if (data.leaseType === 'At-will' && data.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'At-will leases must not carry an endDate (BR-LL-1).',
    });
  }
}

export const leaseCreateSchema = z.object(base).superRefine(applyBrLl1);

export const leaseUpdateSchema = z
  .object({
    ...base,
    propertyId: base.propertyId.optional(),
    unitId: base.unitId.optional(),
    tenants: z.array(tenantRefSchema).optional(),
    leaseType: base.leaseType.optional(),
    startDate: base.startDate.optional(),
    primaryRent: primaryRentSchema.optional(),
    status: z.enum(LEASE_STATUSES as unknown as [string, ...string[]]).optional(),
    evictionPending: z.boolean().optional(),
    evictionPendingNote: z.string().max(2000).optional(),
  })
  .superRefine(applyBrLl1)
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

/** Body for PATCH /leases/:id/eviction — toggles the overlay attribute. */
export const leaseEvictionToggleSchema = z.object({
  evictionPending: z.boolean(),
  evictionPendingNote: z.string().max(2000).optional(),
});

export type LeaseCreate = z.infer<typeof leaseCreateSchema>;
export type LeaseUpdate = z.infer<typeof leaseUpdateSchema>;
export type LeaseEvictionToggle = z.infer<typeof leaseEvictionToggleSchema>;
