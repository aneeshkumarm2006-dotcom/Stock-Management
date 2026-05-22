// Zod validators for RentersInsurancePolicy (PDR §3.31).
import { z } from 'zod';
import { Types } from 'mongoose';
import { RENTERS_INSURANCE_CARRIERS } from '@/types/pm';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const base = {
  leaseId: objectIdString,
  carrier: z.enum(RENTERS_INSURANCE_CARRIERS as unknown as [string, ...string[]]),
  policyNumber: z.string().max(80).optional(),
  liabilityCoverage: z.number().nonnegative(),
  effectiveDate: z.string().min(8),
  expirationDate: z.string().min(8),
  coveredResidents: z.array(objectIdString).optional(),
  documentFileId: objectIdString.nullable().optional(),
};

export const rentersInsuranceCreateSchema = z.object(base);

export const rentersInsuranceUpdateSchema = z
  .object({
    ...base,
    leaseId: base.leaseId.optional(),
    carrier: base.carrier.optional(),
    liabilityCoverage: base.liabilityCoverage.optional(),
    effectiveDate: base.effectiveDate.optional(),
    expirationDate: base.expirationDate.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type RentersInsuranceCreate = z.infer<typeof rentersInsuranceCreateSchema>;
export type RentersInsuranceUpdate = z.infer<typeof rentersInsuranceUpdateSchema>;
