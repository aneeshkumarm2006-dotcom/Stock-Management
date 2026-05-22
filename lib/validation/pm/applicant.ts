// Zod validators for Applicant (PDR §3.7). Includes the 14-default checklist
// shape (BR-LA-5) — clients submit only the items they want to toggle, the
// API merges against the persisted set.
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  APPLICANT_STATUSES,
  APPLICANT_SCREENING_STATUSES,
} from '@/types/pm';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const phoneSchema = z.object({
  number: z.string().max(40),
  label: z.string().max(30).optional(),
});

const addressSchema = z.object({
  line1: z.string().max(120).optional(),
  line2: z.string().max(120).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(2).optional(),
  zip: z.string().max(10).optional(),
  country: z.string().max(2).optional(),
});

const rentalHistorySchema = z.object({
  address: z.string().max(200).optional(),
  landlordName: z.string().max(120).optional(),
  landlordPhone: z.string().max(40).optional(),
  startDate: z.string().min(8).nullable().optional(),
  endDate: z.string().min(8).nullable().optional(),
  monthlyRent: z.number().nonnegative().optional(),
  reasonForLeaving: z.string().max(2000).optional(),
});

const employmentSchema = z.object({
  employer: z.string().max(120).optional(),
  position: z.string().max(120).optional(),
  monthlyIncome: z.number().nonnegative().optional(),
  startDate: z.string().min(8).nullable().optional(),
  endDate: z.string().min(8).nullable().optional(),
  supervisorName: z.string().max(120).optional(),
  supervisorPhone: z.string().max(40).optional(),
});

const base = {
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional().or(z.literal('')),
  phones: z.array(phoneSchema).max(4).optional(),
  propertyId: objectIdString.nullable().optional(),
  unitId: objectIdString.nullable().optional(),
  applicantAddress: addressSchema.optional(),
  applicantBirthDate: z.string().min(8).nullable().optional(),
  applicantSsnLast4: z.string().regex(/^\d{4}$/).optional(),
  rentalHistory: z.array(rentalHistorySchema).max(20).optional(),
  employment: z.array(employmentSchema).max(20).optional(),
  emailLinkToOnlineApplication: z.boolean().optional(),
  sourceProspectId: objectIdString.nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
};

export const applicantCreateSchema = z.object(base);

export const applicantUpdateSchema = z
  .object({
    ...base,
    firstName: base.firstName.optional(),
    lastName: base.lastName.optional(),
    status: z.enum(APPLICANT_STATUSES as unknown as [string, ...string[]]).optional(),
    screeningStatus: z
      .enum(APPLICANT_SCREENING_STATUSES as unknown as [string, ...string[]])
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

/** Body for PATCH /applicants/:id/checklist/:itemId — flips one item. */
export const applicantChecklistToggleSchema = z.object({
  checked: z.boolean(),
});

export type ApplicantCreate = z.infer<typeof applicantCreateSchema>;
export type ApplicantUpdate = z.infer<typeof applicantUpdateSchema>;
export type ApplicantChecklistToggle = z.infer<typeof applicantChecklistToggleSchema>;
