// Zod validators for DraftLease (PDR §3.4). Client sends money in dollars;
// the route converts to integer cents before persisting.
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  ESIGNATURE_STATUSES,
  LEASE_TYPES,
  RENT_CYCLES,
  DRAFT_LEASE_EXECUTION_STATUSES,
} from '@/types/pm';
import { LEASE_INLINE_FILE_CAP } from '@/lib/db/models/pm/DraftLease';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const memo = z.string().max(100); // BR-PU-6

const tenantRefSchema = z.object({
  tenantId: objectIdString.nullable().optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  email: z.string().email().optional().or(z.literal('')),
  isCosigner: z.boolean().optional(),
});

const approvedApplicantRefSchema = z.object({
  applicantId: objectIdString,
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
});

const splitRentSchema = z.object({
  accountId: objectIdString.optional(),
  amount: z.number().nonnegative().optional(),
  memo: memo.optional(),
});

const primaryRentSchema = z.object({
  amount: z.number().nonnegative().optional(),
  accountId: objectIdString.optional(),
  nextDueDate: z.string().nullable().optional(),
  memo: memo.optional(),
});

const recurringChargeSchema = z.object({
  amount: z.number().nonnegative().optional(),
  accountId: objectIdString.optional(),
  frequency: z.enum(RENT_CYCLES as unknown as [string, ...string[]]).optional(),
  nextDate: z.string().nullable().optional(),
  memo: memo.optional(),
  postNDaysInAdvance: z.number().int().min(0).max(30).optional(),
});

const oneTimeChargeSchema = z.object({
  amount: z.number().nonnegative().optional(),
  accountId: objectIdString.optional(),
  dueDate: z.string().nullable().optional(),
  memo: memo.optional(),
  isMoveInCharge: z.boolean().optional(),
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
  label: z.string().max(200).optional(),
  status: z.enum(ESIGNATURE_STATUSES as unknown as [string, ...string[]]).optional(),
});

// Presence requirements (propertyId, unitId, startDate, primaryRent.accountId)
// are now warnings (computeWarnings → MISSING_PROPERTY_OR_UNIT,
// MISSING_RENT_ACCOUNT). The Zod schema keeps type/format guards only.
const base = {
  propertyId: objectIdString.optional(),
  unitId: objectIdString.optional(),
  leaseType: z.enum(LEASE_TYPES as unknown as [string, ...string[]]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  rentCycle: z.enum(RENT_CYCLES as unknown as [string, ...string[]]).optional(),
  primaryRent: primaryRentSchema.optional(),
  splitRentCharges: z.array(splitRentSchema).optional(),
  securityDeposit: z.number().nonnegative().optional(),
  recurringCharges: z.array(recurringChargeSchema).optional(),
  oneTimeCharges: z.array(oneTimeChargeSchema).optional(),
  moveInCharges: z.array(oneTimeChargeSchema).optional(),
  lateFeePolicy: lateFeeSchema.optional(),
  leasingAgentUserId: objectIdString.nullable().optional(),
  approvedApplicants: z.array(approvedApplicantRefSchema).optional(),
  tenants: z.array(tenantRefSchema).optional(),
  cosigners: z.array(tenantRefSchema).optional(),
  residentCenterWelcomeEmail: z.boolean().optional(),
  esignatureDocuments: z.array(esigDocSchema).optional(),
  comments: z.string().max(4000).optional(),
  recentNotes: z.string().max(4000).optional(),
  files: z.array(objectIdString).max(LEASE_INLINE_FILE_CAP).optional(),
  customFields: z.record(z.unknown()).optional(),
};

export const draftLeaseCreateSchema = z.object(base);

export const draftLeaseUpdateSchema = z
  .object({
    ...base,
    signatureStatus: z
      .enum(ESIGNATURE_STATUSES as unknown as [string, ...string[]])
      .optional(),
    esignatureStatus: z
      .enum(ESIGNATURE_STATUSES as unknown as [string, ...string[]])
      .optional(),
    executionStatus: z
      .enum(DRAFT_LEASE_EXECUTION_STATUSES as unknown as [string, ...string[]])
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

/** Allowed executionStatus transitions (DECISIONS.md Phase 3 [G-B-1]).
 *  `Cancelled → Draft` is reversible per [G-B-1] iff no Lease was promoted —
 *  the API enforces the `promotedToLeaseId==null` half of that rule. */
export const DRAFT_LEASE_EXECUTION_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Out for signature', 'Cancelled'],
  'Out for signature': ['Ready to execute', 'Draft', 'Cancelled'],
  'Ready to execute': ['Executed', 'Out for signature', 'Cancelled'],
  Cancelled: ['Draft'],
  Executed: [],
};

export function isValidDraftLeaseTransition(
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  return (DRAFT_LEASE_EXECUTION_TRANSITIONS[from] ?? []).includes(to);
}

/** Body for POST /draft-leases/:id/cancel. */
export const draftLeaseCancelSchema = z.object({
  reason: z.string().max(1000).optional(),
});

/** Body for POST /draft-leases/:id/execute. */
export const draftLeaseExecuteSchema = z.object({
  postingDate: z.string().min(8).optional(),
  /** When true and the caller has the FinancialAdministrator role, the
   *  underlying JE write skips locked-period gating. */
  overrideLockedPeriod: z.boolean().optional(),
});

export type DraftLeaseCreate = z.infer<typeof draftLeaseCreateSchema>;
export type DraftLeaseUpdate = z.infer<typeof draftLeaseUpdateSchema>;
export type DraftLeaseCancel = z.infer<typeof draftLeaseCancelSchema>;
export type DraftLeaseExecute = z.infer<typeof draftLeaseExecuteSchema>;
