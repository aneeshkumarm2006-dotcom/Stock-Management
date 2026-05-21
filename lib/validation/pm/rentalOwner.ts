// Zod validators for RentalOwner. PDR §3.6.
import { z } from 'zod';

const phoneSchema = z.object({
  number: z.string().max(40),
  smsOptIn: z.boolean().optional(),
});

const addressSchema = z.object({
  line1: z.string().max(120).optional(),
  line2: z.string().max(120).optional(),
  line3: z.string().max(120).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(2).optional(),
  zip: z.string().max(10).optional(),
  country: z.string().max(2).optional(),
});

const baseFields = {
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  isCompany: z.boolean().optional(),
  companyName: z.string().max(160).optional(),
  dateOfBirth: z.string().datetime().nullable().optional(),
  managementAgreement: z
    .object({
      startDate: z.string().datetime().nullable().optional(),
      endDate: z.string().datetime().nullable().optional(),
    })
    .optional(),
  primaryEmail: z.string().email().optional(),
  alternateEmail: z.string().email().optional(),
  phones: z
    .object({
      mobile: phoneSchema.optional(),
      home: phoneSchema.optional(),
      work: phoneSchema.optional(),
      fax: phoneSchema.optional(),
    })
    .optional(),
  address: addressSchema.optional(),
  comments: z.string().max(4000).optional(),
  taxIdentityType: z.enum(['SSN', 'EIN', 'ITIN']).nullable().optional(),
  taxpayerIdLast4: z.string().regex(/^\d{4}$/).optional(),
  use1099AlternateName: z.boolean().optional(),
  alternativeName1099: z.string().max(160).optional(),
  use1099AlternateAddress: z.boolean().optional(),
  alternativeAddress1099: addressSchema.optional(),
  customFields: z.record(z.unknown()).optional(),
};

export const rentalOwnerCreateSchema = z
  .object(baseFields)
  .refine((d) => !d.isCompany || (d.companyName && d.companyName.trim().length > 0), {
    message: 'companyName is required when isCompany=true',
    path: ['companyName'],
  });

export const rentalOwnerUpdateSchema = z
  .object({
    firstName: baseFields.firstName.optional(),
    lastName: baseFields.lastName.optional(),
    isCompany: baseFields.isCompany,
    companyName: baseFields.companyName,
    dateOfBirth: baseFields.dateOfBirth,
    managementAgreement: baseFields.managementAgreement,
    primaryEmail: baseFields.primaryEmail,
    alternateEmail: baseFields.alternateEmail,
    phones: baseFields.phones,
    address: baseFields.address,
    comments: baseFields.comments,
    taxIdentityType: baseFields.taxIdentityType,
    taxpayerIdLast4: baseFields.taxpayerIdLast4,
    use1099AlternateName: baseFields.use1099AlternateName,
    alternativeName1099: baseFields.alternativeName1099,
    use1099AlternateAddress: baseFields.use1099AlternateAddress,
    alternativeAddress1099: baseFields.alternativeAddress1099,
    customFields: baseFields.customFields,
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type RentalOwnerCreate = z.infer<typeof rentalOwnerCreateSchema>;
export type RentalOwnerUpdate = z.infer<typeof rentalOwnerUpdateSchema>;
